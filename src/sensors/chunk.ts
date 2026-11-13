// A definition or stimulus as the pod commands that upload it (benchpod-firmware docs/API.md,
// "Emulated sensors": sensor_define, sensor_stimulus). The JSON is cut into byte ranges, each sent
// base64 encoded with its offset and the total, so every command line fits a cloud command (at
// most 1280 bytes).

/** The longest command line the pod takes over the cloud. */
export const MAX_COMMAND_BYTES = 1280
/** Raw bytes per chunk at most: 1024 base64 characters, a command of at most 1152 bytes (the size
 * the firmware documents and the SDK sends; `data_b64` itself takes at most 1240 characters). */
export const MAX_CHUNK_BYTES = 768
/** The largest definition or stimulus the pod takes (`total`). */
export const MAX_UPLOAD_BYTES = 32768

const enc = new TextEncoder()

/** Standard base64 (with padding) of bytes. */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Bytes of base64 (standard or URL alphabet, padding optional). */
export function fromBase64(b64: string): Uint8Array {
  const t = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export type ChunkCommand = {
  cmd: string
  instance?: string
  offset: number
  total: number
  data_b64: string
  dry_run?: boolean
}

/**
 * The commands that upload `json` (a definition with `instance`, or a stimulus without). Each
 * command's JSON text, plus the line end, is at most `maxBytes`. Chunks are whole multiples of 3
 * bytes (no padding inside the stream) except the last. `dryRun` goes on the last chunk.
 */
export function chunkCommands(
  cmd: 'sensor_define' | 'sensor_stimulus',
  json: string,
  opts: { instance?: string; dryRun?: boolean; maxBytes?: number } = {},
): ChunkCommand[] {
  const bytes = enc.encode(json)
  const total = bytes.length
  const maxBytes = opts.maxBytes ?? MAX_COMMAND_BYTES
  const head = (offset: number, data: string, last: boolean): ChunkCommand => ({
    cmd,
    ...(opts.instance !== undefined ? { instance: opts.instance } : {}),
    offset,
    total,
    data_b64: data,
    ...(last && opts.dryRun ? { dry_run: true } : {}),
  })
  // What a command costs besides its data, at the widest offset (and the dry_run flag), plus "\n".
  const overhead = byteLength(JSON.stringify(head(total, '', true))) + 1
  const budget = Math.min(Math.floor((maxBytes - overhead) / 4) * 3, MAX_CHUNK_BYTES)
  if (budget < 3) throw new Error('command size limit too small for one chunk')
  const out: ChunkCommand[] = []
  for (let off = 0; off < total || (total === 0 && out.length === 0); off += budget) {
    const end = Math.min(total, off + budget)
    out.push(head(off, toBase64(bytes.subarray(off, end)), end >= total))
    if (total === 0) break
  }
  return out
}

/** Put chunked commands back together (tests, and a fake pod). */
export function joinChunks(cmds: { offset: number; total: number; data_b64: string }[]): string {
  const total = cmds[0]?.total ?? 0
  const out = new Uint8Array(total)
  let expect = 0
  for (const c of cmds) {
    if (c.offset !== expect) throw new Error(`chunk at offset ${c.offset}, expected ${expect}`)
    const b = fromBase64(c.data_b64)
    out.set(b, c.offset)
    expect += b.length
  }
  if (expect !== total) throw new Error(`received ${expect} of ${total} bytes`)
  return new TextDecoder().decode(out)
}

function byteLength(s: string): number {
  return enc.encode(s).length
}
