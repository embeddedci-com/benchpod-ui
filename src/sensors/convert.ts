// A definition or stimulus file (YAML, or JSON with the same structure) to the JSON a pod
// receives, plus what the editor needs to point at an error's line.
import { parseYaml, YamlError, type YamlValue } from './yaml'

/** The most a definition may be, as source and as JSON (format.md, section 1). */
export const MAX_DEFINITION_BYTES = 32768

export type SourceFormat = 'yaml' | 'json'

export type Converted = {
  ok: true
  format: SourceFormat
  doc: { [k: string]: YamlValue }
  /** Compact JSON, the form the pod and the engine take. */
  json: string
  /** Path (`registers[3].s16be`) to its 1-based line in the source. */
  locs: Map<string, number>
}

export type ConvertError = { ok: false; error: string; line: number | null }

const enc = new TextEncoder()

/** UTF-8 size of a string. */
export const byteLength = (s: string): number => enc.encode(s).length

/** JSON when the first non-space character is `{`, else YAML (the server's rule). */
export function detectFormat(text: string): SourceFormat {
  return text.replace(/^﻿/, '').trimStart().startsWith('{') ? 'json' : 'yaml'
}

/** Where each top-level key of a JSON text starts, so a JSON source points at lines too. */
function jsonLocs(text: string): Map<string, number> {
  const locs = new Map<string, number>()
  const lines = text.split('\n')
  lines.forEach((l, i) => {
    const m = /^\s{0,2}"([^"]+)"\s*:/.exec(l)
    if (m && !locs.has(m[1])) locs.set(m[1], i + 1)
  })
  return locs
}

/** Parse a source text into the pod's JSON. Never throws. */
export function convertSource(text: string): Converted | ConvertError {
  if (byteLength(text) > MAX_DEFINITION_BYTES) {
    return { ok: false, error: `the file is ${byteLength(text)} bytes; at most ${MAX_DEFINITION_BYTES} are allowed`, line: null }
  }
  const format = detectFormat(text)
  let value: YamlValue
  let locs: Map<string, number>
  try {
    if (format === 'json') {
      value = JSON.parse(text.replace(/^﻿/, '')) as YamlValue
      locs = jsonLocs(text)
    } else {
      ;({ value, locs } = parseYaml(text))
    }
  } catch (e) {
    if (e instanceof YamlError) return { ok: false, error: `invalid YAML: ${e.message}`, line: e.line }
    return { ok: false, error: `invalid JSON: ${(e as Error).message}`, line: null }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'the top level must be a mapping (key: value)', line: 1 }
  }
  const dataFile = findDataFile(value)
  if (dataFile) {
    return {
      ok: false,
      error: `${dataFile}: a data file cannot be read here; put its values in points: [[t, value], ...]`,
      line: locs.get(dataFile) ?? null,
    }
  }
  const json = JSON.stringify(value)
  if (byteLength(json) > MAX_DEFINITION_BYTES) {
    return { ok: false, error: `the definition is ${byteLength(json)} bytes as JSON; at most ${MAX_DEFINITION_BYTES} are allowed`, line: null }
  }
  return { ok: true, format, doc: value, json, locs }
}

/** A stimulus `data` segment with `file:` (only yaml2json.py, which reads files, inlines those). */
function findDataFile(doc: { [k: string]: YamlValue }): string | null {
  if (doc.kind !== 'stimulus' || !doc.signals || typeof doc.signals !== 'object' || Array.isArray(doc.signals)) return null
  const walk = (segs: YamlValue, path: string): string | null => {
    if (!Array.isArray(segs)) return null
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (!s || typeof s !== 'object' || Array.isArray(s)) continue
      if (s.shape === 'data' && 'file' in s) return `${path}[${i}].file`
      if (s.shape === 'repeat') {
        const r = walk(s.segments ?? null, `${path}[${i}].segments`)
        if (r) return r
      }
    }
    return null
  }
  for (const [name, segs] of Object.entries(doc.signals)) {
    const r = walk(segs, `signals.${name}`)
    if (r) return r
  }
  return null
}

/** The `name:` of a source, or '' (for file names). */
export function sourceName(text: string): string {
  const c = convertSource(text)
  return c.ok && typeof c.doc.name === 'string' ? c.doc.name : ''
}
