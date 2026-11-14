import { parseYaml, type YamlValue } from '../sensors/yaml'

// Device mode: a sensor definition (benchpod-sensors format, sections 3 and 4) read the other way
// round. The pod is the I2C or SPI master and the real chip the target, so the definition gives
// the register map: names, addresses, field types and what may be written. Values are decoded by
// the field type (u16be, s16le, text...). The register expressions are not evaluated: they turn
// params into codes for the emulation, not codes into units.

export type FieldType =
  | 'u8' | 's8'
  | 'u16be' | 'u16le' | 's16be' | 's16le'
  | 'u24be' | 'u24le' | 's24be' | 's24le'
  | 'u32be' | 'u32le' | 's32be' | 's32le'
  | 'bytes' | 'text'

const INT_TYPES: FieldType[] = ['u8', 's8', 'u16be', 'u16le', 's16be', 's16le', 'u24be', 'u24le', 's24be', 's24le', 'u32be', 'u32le', 's32be', 's32le']

export type DeviceReg = {
  /** Its index in the definition's list. */
  id: number
  /** The register (or command) as the bus addresses it: 8 or 16 bits. */
  at: number
  name: string
  type: FieldType
  /** Bytes the field spans. */
  size: number
  writable: boolean
  /** A command (Sensirion style): write it, wait busy_us, then read `size` bytes (0: nothing). */
  command?: { busyUs: number }
}

export type DeviceDef = {
  name: string
  kind: 'i2c' | 'spi'
  label: string
  i2c?: { address: number; alt: number[]; addressBytes: 1 | 2 }
  spi?: { mode: number; readBit: { bit: number; value: 0 | 1 }; incBit: { bit: number; value: 0 | 1 } | null; mask: number; dummy: number }
  regs: DeviceReg[]
}

type Obj = { [k: string]: YamlValue }
const isObj = (v: YamlValue | undefined): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: YamlValue | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export const typeSize = (t: FieldType): number => (t === 'u8' || t === 's8' ? 1 : Number(t.slice(1, 3)) / 8)
const signed = (t: FieldType) => t.startsWith('s')
const little = (t: FieldType) => t.endsWith('le')

const bitSpec = (v: YamlValue | undefined): { bit: number; value: 0 | 1 } | null =>
  isObj(v) ? { bit: num(v.bit, 7), value: num(v.value, 1) ? 1 : 0 } : null

/** A definition's YAML as a register map for the pod as master; a string says why it cannot be one. */
export function parseDevice(yaml: string): DeviceDef | string {
  let doc: YamlValue
  try {
    doc = parseYaml(yaml).value
  } catch (e) {
    return (e as Error).message
  }
  if (!isObj(doc)) return 'not a sensor definition'
  const kind = doc.kind
  if (kind !== 'i2c' && kind !== 'spi') return `a ${String(kind)} definition has no registers to read over I2C or SPI`
  const def: DeviceDef = { name: String(doc.name ?? ''), kind, label: String(doc.label ?? doc.name ?? ''), regs: [] }

  // Word registers: register p is two bytes; `at` is the register, which is also the pointer byte.
  let wordRegs = false
  let page = 0
  if (kind === 'i2c') {
    const b = isObj(doc.i2c) ? doc.i2c : {}
    const bits = num(b.register_address_bits, 8)
    page = num(b.page, 0)
    wordRegs = num(b.register_bytes, 1) === 2
    def.i2c = {
      address: num(b.address, 0),
      alt: Array.isArray(b.alt_addresses) ? b.alt_addresses.filter((x): x is number => typeof x === 'number') : [],
      addressBytes: bits === 16 ? 2 : 1,
    }
  } else {
    const b = isObj(doc.spi) ? doc.spi : {}
    def.spi = {
      mode: num(b.mode, 0),
      readBit: bitSpec(b.read_bit) ?? { bit: 7, value: 1 },
      incBit: bitSpec(b.increment_bit),
      mask: num(b.address_mask, 0x7f),
      dummy: num(b.dummy_bytes, 0),
    }
  }
  const at = (v: number) => (page && v < 0x100 ? page + v : v)

  const field = (e: Obj): { type: FieldType; size: number } | null => {
    for (const t of INT_TYPES) if (t in e) return { type: t, size: typeSize(t) }
    if (Array.isArray(e.bytes)) return { type: 'bytes', size: e.bytes.length }
    if (typeof e.text === 'string') return { type: 'text', size: e.text.length }
    return null
  }

  // No name: a field that is a bare param (`s16le: T2`) is named by it, else by the address.
  const regName = (e: Obj, t: FieldType): string => {
    if (typeof e.name === 'string') return e.name
    const v = e[t]
    if (typeof v === 'string' && /^[A-Za-z_]\w*$/.test(v)) return v
    return `0x${(e.at as number).toString(16).padStart(2, '0')}`
  }

  for (const e of Array.isArray(doc.registers) ? doc.registers : []) {
    if (!isObj(e) || typeof e.at !== 'number') continue
    const f = field(e)
    if (!f || !f.size) continue
    def.regs.push({
      id: def.regs.length,
      at: at(e.at),
      name: regName(e, f.type),
      type: f.type,
      size: f.size,
      writable: e.writable !== false,
    })
  }
  for (const e of Array.isArray(doc.commands) ? doc.commands : []) {
    if (!isObj(e) || typeof e.command !== 'number') continue
    const answer = Array.isArray(e.answer) ? e.answer.length : 0
    def.regs.push({
      id: def.regs.length,
      at: e.command,
      name: typeof e.name === 'string' ? e.name : `command 0x${e.command.toString(16).toUpperCase()}`,
      type: 'bytes',
      size: answer,
      writable: false,
      command: { busyUs: num(e.busy_us, 0) },
    })
  }
  if (wordRegs) for (const r of def.regs) if (r.type === 'u8' || r.type === 's8') r.size = 2
  return def
}

const hexOf = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (hex: string) => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16))

/** The register address bytes an I2C read or write starts with, as hex. */
export function i2cRegHex(def: DeviceDef, r: DeviceReg): string {
  return def.i2c?.addressBytes === 2 ? hexOf([(r.at >> 8) & 0xff, r.at & 0xff]) : hexOf([r.at & 0xff])
}

/** The SPI command byte: the address bits, the read bit set for a read, auto increment for more than one byte. */
export function spiCmd(def: DeviceDef, r: DeviceReg, read: boolean): number {
  const s = def.spi!
  let b = r.at & s.mask
  const rb = 1 << s.readBit.bit
  b = (read ? s.readBit.value : 1 - s.readBit.value) ? b | rb : b & ~rb
  if (s.incBit && r.size > 1) b = s.incBit.value ? b | (1 << s.incBit.bit) : b & ~(1 << s.incBit.bit)
  return b & 0xff
}

/** spi_transfer's tx_hex to read a register: the command, the dummy bytes, then a 00 per byte. */
export function spiReadHex(def: DeviceDef, r: DeviceReg): string {
  return hexOf([spiCmd(def, r, true), ...Array(def.spi!.dummy + r.size).fill(0)])
}

/** The bytes of a register in what an SPI read clocked back (after the command and dummy bytes). */
export function spiReadValue(def: DeviceDef, rxHex: string): string {
  return rxHex.slice(2 * (1 + def.spi!.dummy))
}

/** spi_transfer's tx_hex to write a register's bytes (hex). */
export function spiWriteHex(def: DeviceDef, r: DeviceReg, valueHex: string): string {
  return hexOf([spiCmd(def, r, false)]) + valueHex
}

/**
 * A register's bytes (hex) as a value: a signed or unsigned integer in the field's byte order, a
 * text, or the bytes. Word registers read as 8-bit fields show the whole word.
 */
export function decodeValue(r: DeviceReg, hex: string): string {
  const b = bytesOf(hex)
  if (r.type === 'text') return JSON.stringify(String.fromCharCode(...b))
  if (r.type === 'bytes' || b.length < r.size || !b.length) return b.map((x) => x.toString(16).padStart(2, '0')).join(' ')
  const t = r.type
  const n = r.size
  const ordered = little(t) ? b.slice(0, n).reverse() : b.slice(0, n)
  let v = ordered.reduce((acc, x) => acc * 256 + x, 0)
  if (signed(t) && v >= 2 ** (8 * n - 1)) v -= 2 ** (8 * n)
  return String(v)
}

/** A value typed by the user ("25", "-3", "0x1f", or hex bytes for bytes) as the register's bytes; a string error. */
export function encodeValue(r: DeviceReg, input: string): { hex: string } | { error: string } {
  const t = input.trim()
  if (r.type === 'text') {
    const codes = [...t].map((c) => c.charCodeAt(0))
    if (codes.some((c) => c > 0x7f)) return { error: 'ASCII only' }
    return { hex: hexOf(codes) }
  }
  if (r.type === 'bytes') {
    const h = t.toLowerCase().replace(/0x/g, '').replace(/[\s,]+/g, '')
    return /^([0-9a-f]{2})+$/.test(h) ? { hex: h } : { error: 'hex bytes' }
  }
  const n = r.size
  let v: number
  if (/^-?0x[0-9a-f]+$/i.test(t)) v = (t.startsWith('-') ? -1 : 1) * parseInt(t.replace('-', '').slice(2), 16)
  else if (/^-?\d+$/.test(t)) v = Number(t)
  else return { error: 'a number, e.g. 25 or 0x19' }
  const lo = signed(r.type) ? -(2 ** (8 * n - 1)) : 0
  const hi = signed(r.type) ? 2 ** (8 * n - 1) - 1 : 2 ** (8 * n) - 1
  // An unsigned-looking hex value fits a signed field as its two's complement.
  if (signed(r.type) && v > hi && v <= 2 ** (8 * n) - 1) v -= 2 ** (8 * n)
  if (v < lo || v > hi) return { error: `${lo} to ${hi}` }
  if (v < 0) v += 2 ** (8 * n)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.unshift(Math.floor(v / 2 ** (8 * i)) % 256)
  return { hex: hexOf(little(r.type) ? out.reverse() : out) }
}
