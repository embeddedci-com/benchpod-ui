// Where definitions and stimuli live. The web app implements SensorStore over the server's
// routes (/api/benchpod/sensor-definitions, /api/benchpod/sensor-library); the desktop app over
// its local API. MemorySensorStore is a complete in-memory one, for tests and as the reference.
import { convertSource, type SourceFormat } from './convert'
import type { DefinitionKind } from './engine'
import { toYaml, type YamlValue } from './yaml'
import { copyName, renameSource } from './templates'

export type DefinitionSummary = {
  id: string
  name: string
  kind: DefinitionKind
  label: string
  source_format: SourceFormat
  created_at: string
  updated_at: string
  created_by?: string
}

export type StoredDefinition = DefinitionSummary & {
  /** The text as written (comments and all). */
  source: string
  /** The parsed definition (the JSON the pod receives), when the store has it. */
  definition?: unknown
}

export type LibraryEntry = { name: string; kind: DefinitionKind; label: string; path: string }

export type LibraryListing = {
  /** What was asked for: '' (the organization's choice), 'latest' or X.Y.Z. */
  requested: string
  /** The version served. */
  version: string
  origin: string
  pinned_version: string
  embedded_version: string
  warnings?: string[]
  entries: LibraryEntry[]
}

export type LibraryEntryFull = LibraryEntry & {
  version: string
  origin?: string
  warnings?: string[]
  source_format: SourceFormat
  source: string
  definition?: unknown
}

export type LibrarySettings = {
  /** The organization's choice: '' (the pinned version), 'latest' or X.Y.Z. */
  override: string
  pinned_version: string
  embedded_version: string
  repo?: string
  /** The user may change it (organization owners and admins). */
  can_change: boolean
  warnings?: string[]
}

/** A file to hand to the user. */
export type FileBlob = { blob: Blob; filename: string }

/** A store refusal: `code` is 'invalid_definition', 'name_taken', 'not_found' or the host's own. */
export class SensorStoreError extends Error {
  override name = 'SensorStoreError'
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export const isNameTaken = (e: unknown) => (e as { code?: string } | null)?.code === 'name_taken'

export interface SensorStore {
  /** The user's (or organization's) definitions and stimuli; `kind` filters. */
  list(kind?: DefinitionKind): Promise<{ definitions: DefinitionSummary[]; full_validation?: boolean }>
  get(id: string): Promise<StoredDefinition>
  /** Create (no id) or replace a definition from its source text (YAML or JSON). */
  save(source: string, id?: string): Promise<StoredDefinition>
  delete(id: string): Promise<void>
  /** A copy under another name (default `<name>_copy`, `_copy2`, ...). */
  duplicate(id: string, name?: string): Promise<StoredDefinition>
  /** A file the user picked; `replace` overwrites the one with the same name. */
  upload(file: Blob, filename: string, opts?: { replace?: boolean }): Promise<{ replaced: boolean; definition: StoredDefinition }>
  /** One definition as a file (its own format, or converted). */
  download(id: string, format?: SourceFormat): Promise<FileBlob>
  /** All of them as a zip: sensors/<kind>/<name>.<ext>, stimuli/<name>.<ext>. */
  zip(opts?: { kind?: DefinitionKind; format?: SourceFormat }): Promise<FileBlob>
  /** The public library at the active version (or `version` to preview another). */
  library(version?: string): Promise<LibraryListing>
  libraryEntry(name: string, version?: string): Promise<LibraryEntryFull>
  libraryDownload(name: string, opts?: { format?: SourceFormat; version?: string }): Promise<FileBlob>
  librarySettings(): Promise<LibrarySettings>
  /** '' (back to the pinned version), 'latest' or X.Y.Z. */
  setLibraryVersion(version: string): Promise<LibrarySettings>
}

/**
 * Copy a library entry into the user's definitions: the entry's source, saved as is, or under
 * `<name>_copy` (then `_copy2`, ...) when the name is taken.
 */
export async function copyLibraryEntry(store: SensorStore, name: string, version?: string): Promise<StoredDefinition> {
  const entry = await store.libraryEntry(name, version)
  let source = entry.source
  for (let n = 0; n < 20; n++) {
    try {
      return await store.save(source)
    } catch (e) {
      if (!isNameTaken(e)) throw e
      source = renameSource(entry.source, copyName(entry.name, n + 1))
    }
  }
  throw new SensorStoreError(`could not find a free name for ${name}`, 'name_taken')
}

/** A source in another format: YAML to JSON (indented) or JSON to YAML. */
export function convertFormat(source: string, to: SourceFormat): string {
  const c = convertSource(source)
  if (!c.ok || c.format === to) return source
  return to === 'json' ? JSON.stringify(c.doc, null, 2) + '\n' : toYaml(c.doc as YamlValue)
}

const extOf = (f: SourceFormat) => (f === 'json' ? 'json' : 'yaml')

/** Where a definition goes in a zip. */
export const zipPath = (d: { kind: DefinitionKind; name: string }, format: SourceFormat) =>
  d.kind === 'stimulus' ? `stimuli/${d.name}.${extOf(format)}` : `sensors/${d.kind}/${d.name}.${extOf(format)}`

// ---- zip (stored, no compression) ----

let crcTable: Uint32Array | null = null
function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A zip of text files (stored, UTF-8 names), for "download all". */
export function makeZip(files: { path: string; text: string }[]): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.path)
    const data = enc.encode(f.text)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cen.set(name, 46)
    parts.push(local, data)
    central.push(cen)
    offset += local.length + data.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' })
}

// ---- in memory ----

type Validate = (json: string, kind: DefinitionKind) => string | null

/**
 * SensorStore in memory: the server's rules (unique names, a valid header, an optional full
 * validator such as the engine), no persistence.
 */
export class MemorySensorStore implements SensorStore {
  private defs = new Map<string, StoredDefinition>()
  private seq = 0
  private override = ''
  constructor(
    private readonly lib: { version: string; entries: { source: string; path?: string }[] } = { version: '0.0.0', entries: [] },
    private readonly validate?: Validate,
    private readonly opts: { canChangeLibrary?: boolean; now?: () => string } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date().toISOString()
  }

  private parse(source: string) {
    const c = convertSource(source)
    if (!c.ok) throw new SensorStoreError(c.error, 'invalid_definition')
    const kind = c.doc.kind as DefinitionKind
    const name = typeof c.doc.name === 'string' ? c.doc.name : ''
    if (!['i2c', 'spi', 'uart', 'analog', 'stimulus'].includes(kind)) throw new SensorStoreError('kind: one of i2c, spi, uart, analog, stimulus', 'invalid_definition')
    if (!/^[a-z0-9_]{1,32}$/.test(name)) throw new SensorStoreError('name: [a-z0-9_]{1,32}', 'invalid_definition')
    const err = this.validate?.(c.json, kind)
    if (err) throw new SensorStoreError(err, 'invalid_definition')
    return { c, kind, name, label: typeof c.doc.label === 'string' ? c.doc.label : '' }
  }

  private taken(name: string, exceptId?: string) {
    for (const d of this.defs.values()) if (d.name === name && d.id !== exceptId) return d
    return null
  }

  private summary(d: StoredDefinition): DefinitionSummary {
    const { source: _s, definition: _d, ...rest } = d
    void _s
    void _d
    return rest
  }

  async list(kind?: DefinitionKind) {
    const definitions = [...this.defs.values()].filter((d) => !kind || d.kind === kind).map((d) => this.summary(d))
    definitions.sort((a, b) => a.name.localeCompare(b.name))
    return { definitions, full_validation: !!this.validate }
  }

  async get(id: string) {
    const d = this.defs.get(id)
    if (!d) throw new SensorStoreError('definition not found', 'not_found')
    return { ...d }
  }

  async save(source: string, id?: string) {
    const { c, kind, name, label } = this.parse(source)
    if (id && !this.defs.has(id)) throw new SensorStoreError('definition not found', 'not_found')
    if (this.taken(name, id)) throw new SensorStoreError(`a definition named "${name}" already exists; rename it in the file (name:)`, 'name_taken')
    const now = this.now()
    const prev = id ? this.defs.get(id) : undefined
    const d: StoredDefinition = {
      id: id ?? `def-${++this.seq}`,
      name,
      kind,
      label,
      source_format: c.format,
      created_at: prev?.created_at ?? now,
      updated_at: now,
      source,
      definition: c.doc,
    }
    this.defs.set(d.id, d)
    return { ...d }
  }

  async delete(id: string) {
    if (!this.defs.delete(id)) throw new SensorStoreError('definition not found', 'not_found')
  }

  async duplicate(id: string, name?: string) {
    const d = await this.get(id)
    let n = 1
    let next = name ?? copyName(d.name)
    while (!name && this.taken(next)) next = copyName(d.name, ++n)
    return this.save(renameSource(d.source, next))
  }

  async upload(file: Blob, filename: string, opts: { replace?: boolean } = {}) {
    void filename
    const source = await file.text()
    const { name } = this.parse(source)
    const old = this.taken(name)
    if (old && !opts.replace) {
      throw new SensorStoreError(`a definition named "${name}" already exists; rename it in the file (name:) or upload again with replace`, 'name_taken')
    }
    return { replaced: !!old, definition: await this.save(source, old?.id) }
  }

  async download(id: string, format?: SourceFormat) {
    const d = await this.get(id)
    const f = format ?? d.source_format
    return { blob: new Blob([convertFormat(d.source, f)], { type: 'text/plain' }), filename: `${d.name}.${extOf(f)}` }
  }

  async zip(opts: { kind?: DefinitionKind; format?: SourceFormat } = {}) {
    const files = [...this.defs.values()]
      .filter((d) => !opts.kind || d.kind === opts.kind)
      .map((d) => {
        const f = opts.format ?? d.source_format
        return { path: zipPath(d, f), text: convertFormat(d.source, f) }
      })
    return { blob: makeZip(files), filename: 'sensor-definitions.zip' }
  }

  private libEntries() {
    return this.lib.entries.map((e) => {
      const c = convertSource(e.source)
      const doc = c.ok ? c.doc : {}
      const kind = String(doc.kind ?? '') as DefinitionKind
      const name = String(doc.name ?? '')
      return {
        name,
        kind,
        label: String(doc.label ?? ''),
        path: e.path ?? zipPath({ kind, name }, 'yaml'),
        source: e.source,
        format: c.ok ? c.format : ('yaml' as SourceFormat),
        doc,
      }
    })
  }

  async library(version?: string) {
    return {
      requested: version ?? this.override,
      version: this.lib.version,
      origin: 'embedded',
      pinned_version: this.lib.version,
      embedded_version: this.lib.version,
      warnings: [],
      entries: this.libEntries().map(({ name, kind, label, path }) => ({ name, kind, label, path })),
    }
  }

  async libraryEntry(name: string) {
    const e = this.libEntries().find((x) => x.name === name)
    if (!e) throw new SensorStoreError('no such library entry', 'not_found')
    return { name: e.name, kind: e.kind, label: e.label, path: e.path, version: this.lib.version, source_format: e.format, source: e.source, definition: e.doc }
  }

  async libraryDownload(name: string, opts: { format?: SourceFormat } = {}) {
    const e = await this.libraryEntry(name)
    const f = opts.format ?? e.source_format
    return { blob: new Blob([convertFormat(e.source, f)], { type: 'text/plain' }), filename: `${e.name}.${extOf(f)}` }
  }

  async librarySettings() {
    return { override: this.override, pinned_version: this.lib.version, embedded_version: this.lib.version, can_change: !!this.opts.canChangeLibrary }
  }

  async setLibraryVersion(version: string) {
    if (!this.opts.canChangeLibrary) throw new SensorStoreError('only organization owners and admins can change the library version', 'forbidden')
    if (version && version !== 'latest' && !/^\d+\.\d+\.\d+$/.test(version)) throw new SensorStoreError('version: "", latest or X.Y.Z', 'invalid')
    this.override = version
    return this.librarySettings()
  }
}
