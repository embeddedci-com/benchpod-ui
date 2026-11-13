import { benchData, type BenchCall, type BenchResult } from '../bench/benchCall'
import { fmtSi as fmtSi3 } from '../results/AdcEnvelope'

// The bus console's transaction log: one row per call from its tabs (I2C, GPIO, the console),
// whatever the protocol. The rows are made from the tool, its arguments and its result, so every
// tab logs the same way and the pod's own error text is kept as is.

export type BusProto = 'I2C' | 'SPI' | 'CAN' | 'GPIO' | 'UART'

/** ack/nack for a bus transfer, ok for any other call that ran, timeout for gpio_wait. */
export type BusStatus = 'ack' | 'nack' | 'ok' | 'timeout' | 'error' | 'declined'

export type BusLogRow = {
  id: number
  /** ms since the epoch */
  time: number
  proto: BusProto
  tool: string
  out: string
  in: string
  status: BusStatus
  /** What the status means: "NACK on byte 2", the pod's error text, the rate the pod runs. */
  note?: string
}

type I2cOpen = { open: boolean; sda?: number; scl?: number; hz?: number; pullups?: string }
type I2cXfer = { addr: number; ack: boolean; rx_hex?: string; nack_at?: number | null }
type I2cScan = { found: number[]; found_hex?: string[] }
type Levels = { levels: { la: number; level: number }[] }
type Wait = { la: number; level: number; reached: boolean; waited: number }

/** fmtSi without trailing zeros: 1 MHz, not 1.00 MHz. */
export function fmtSi(v: number, unit: string): string {
  return fmtSi3(v, unit).replace(/^(-?\d+)\.0+(?=\D)|^(-?\d+\.\d*?)0+(?=\D)/, '$1$2')
}

export const hex2 = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

/** "0102ff" or "01 02 ff" as "01 02 ff". */
export function spacedHex(h: string | undefined): string {
  return (h ?? '').replace(/\s+/g, '').match(/../g)?.join(' ') ?? ''
}

function pins(la: unknown): string {
  const list = Array.isArray(la) ? la : la === undefined || la === null ? [] : [la]
  return list.length ? list.map((c) => (typeof c === 'number' ? `LA${c}` : String(c))).join(', ') : 'all'
}

/** Which byte a NACK was on: 0 = the address, 1..N = the Nth written byte, N+1 = the read address. */
export function nackWhere(nackAt: number | null | undefined, written: number): string {
  if (nackAt === null || nackAt === undefined) return 'NACK'
  if (nackAt === 0) return 'NACK on the address'
  if (nackAt <= written) return `NACK on byte ${nackAt}`
  return 'NACK on the read address'
}

/** A CAN frame as "0x123 01 02 03", with "ext" for a 29-bit id. */
export function canFrameText(id: number, data: number[], ext: boolean, rtr = false): string {
  const idText = `0x${id.toString(16).toUpperCase().padStart(ext ? 8 : 3, '0')}`
  const bytes = data.map((b) => b.toString(16).padStart(2, '0')).join(' ')
  return [idText, ext ? 'ext' : '', rtr ? 'RTR' : `[${data.length}]`, bytes].filter(Boolean).join(' ')
}

type CanFrame = { id: number; data: number[]; ext: boolean; rtr: boolean; fd?: boolean; brs?: boolean; ts_ms: number }

/** What a call sent, for the log's "out" column. */
function outText(tool: string, a: Record<string, unknown>): string {
  switch (tool) {
    case 'i2c_open':
      return `open SDA ${pins(a.sda ?? 'i2c_sda')} SCL ${pins(a.scl ?? 'i2c_scl')}, ${fmtSi(Number(a.hz ?? 100_000), 'Hz')}, ${a.pullups ?? 'pod'} pull-ups`
    case 'i2c_close':
      return 'close'
    case 'i2c_transfer': {
      const w = spacedHex(String(a.write_hex ?? ''))
      const r = Number(a.read ?? 0)
      const parts = [hex2(Number(a.addr))]
      if (w) parts.push(`W ${w}`)
      if (r) parts.push(`R ${r}`)
      if (!w && !r) parts.push('probe')
      return parts.join(' ')
    }
    case 'i2c_scan':
      return `scan ${hex2(Number(a.start ?? 0x08))}..${hex2(Number(a.end ?? 0x77))}`
    case 'set_pull':
      return `pull-ups ${a.enabled ? 'on' : 'off'} ${pins(a.las)}`
    case 'gpio_mode':
      return `${pins(a.la)} ${a.mode ?? 'output'}${a.level !== undefined ? ` at ${a.level}` : ''}`
    case 'gpio_write':
      return `${pins(a.la)} = ${a.level}`
    case 'gpio_read':
      return `read ${pins(a.la)}`
    case 'gpio_pulse':
      return `${pins(a.la)} ${a.count ?? 1} x ${fmtSi(Number(a.width), 's')}`
    case 'gpio_wait':
      return `${pins(a.la)} wait for ${a.level ?? 1} (up to ${a.timeout ?? 5} s)`
    case 'gpio_release':
      return `release ${pins(a.la)}`
    case 'spi_transfer': {
      const pinsUsed = (['sck', 'mosi', 'miso', 'cs'] as const).filter((k) => a[k] !== undefined).map((k) => `${k.toUpperCase()} ${pins(a[k])}`)
      return `${spacedHex(String(a.tx_hex ?? ''))} (mode ${a.mode ?? 0}${pinsUsed.length ? `, ${pinsUsed.join(' ')}` : ''})`
    }
    case 'can_open':
      return `open ${fmtSi(Number(a.bitrate ?? 500_000), 'bit/s')}${a.data_bitrate ? `, data ${fmtSi(Number(a.data_bitrate), 'bit/s')}` : ''}, ${a.mode ?? 'normal'}${a.term ? ', 120 ohm' : ''}`
    case 'can_close':
      return 'close'
    case 'can_status':
      return 'status'
    case 'can_read':
      return 'read'
    case 'can_write':
      return canFrameText(Number(a.can_id), Array.isArray(a.data) ? (a.data as number[]) : [], !!a.ext)
    case 'uart_write':
      return `${String(a.text ?? '')}${a.line_ending === 'crlf' ? '\\r\\n' : a.line_ending === 'none' ? '' : '\\n'}`
    case 'uart_open':
      return `open${a.baud ? ` ${a.baud} baud` : ''}`
    case 'uart_close':
      return 'close'
    default:
      return tool
  }
}

/** One log row for a call and its result. */
export function logRow(id: number, time: number, proto: BusProto, tool: string, args: Record<string, unknown>, r: BenchResult): BusLogRow {
  const row: BusLogRow = { id, time, proto, tool, out: outText(tool, args), in: '', status: 'ok' }
  if (r.declined) return { ...row, status: 'declined', note: r.text || 'not run' }
  if (r.is_error || r.refused) return { ...row, status: 'error', note: r.text || 'the call failed' }
  if (r.confirm) return { ...row, status: 'declined', note: 'waits for a yes' }
  switch (tool) {
    case 'i2c_open': {
      const d = benchData<I2cOpen>(r)
      if (d?.hz) row.note = `pod runs SCL at ${fmtSi(d.hz, 'Hz')}`
      if (d?.sda && d?.scl) row.in = `SDA LA${d.sda}, SCL LA${d.scl}`
      return row
    }
    case 'i2c_transfer': {
      const d = benchData<I2cXfer>(r)
      if (!d) return row
      const written = spacedHex(String(args.write_hex ?? '')).split(' ').filter(Boolean).length
      row.in = spacedHex(d.rx_hex)
      row.status = d.ack ? 'ack' : 'nack'
      if (!d.ack) row.note = nackWhere(d.nack_at, written)
      return row
    }
    case 'spi_transfer': {
      const d = benchData<{ rx_hex: string; hz: number }>(r)
      if (!d) return row
      row.in = spacedHex(d.rx_hex)
      row.note = `SCK ${fmtSi(d.hz, 'Hz')}`
      return row
    }
    case 'can_open': {
      const d = benchData<{ open: boolean; fd?: boolean }>(r)
      if (d?.fd) row.note = 'CAN FD'
      return row
    }
    case 'can_status': {
      const d = benchData<{ reply?: Record<string, unknown> }>(r)
      if (d?.reply) row.in = Object.entries(d.reply).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ')
      return row
    }
    case 'can_write': {
      const d = benchData<{ dlc?: number | null; fd?: boolean | null }>(r)
      if (d?.fd) row.note = 'CAN FD'
      return row
    }
    case 'i2c_scan': {
      const d = benchData<I2cScan>(r)
      if (!d) return row
      row.in = (d.found_hex ?? d.found.map(hex2)).join(' ')
      row.note = d.found.length === 1 ? '1 device' : `${d.found.length} devices`
      return row
    }
    case 'gpio_read': {
      const d = benchData<Levels>(r)
      if (d) row.in = d.levels.map((l) => `LA${l.la}=${l.level}`).join(' ')
      return row
    }
    case 'gpio_wait': {
      const d = benchData<Wait>(r)
      if (!d) return row
      if (d.reached) row.in = `reached after ${fmtSi(d.waited, 's')}`
      else {
        row.status = 'timeout'
        row.note = `still not ${d.level} after ${fmtSi(d.waited, 's')}`
      }
      return row
    }
    default:
      return row
  }
}

/**
 * The log rows for a call: one, except can_read, which gives a row per frame it read (none for a
 * poll that read nothing, so "Keep reading" only logs what came in).
 */
export function logRows(time: number, proto: BusProto, tool: string, args: Record<string, unknown>, r: BenchResult, poll = false): Omit<BusLogRow, 'id'>[] {
  const one = (): Omit<BusLogRow, 'id'>[] => {
    const { id: _id, ...row } = logRow(0, time, proto, tool, args, r)
    return [row]
  }
  if (tool !== 'can_read') return poll ? [] : one()
  const d = benchData<{ frames: CanFrame[] }>(r)
  if (!d) return one()
  if (!d.frames.length) return poll ? [] : [{ time, proto, tool, out: 'read', in: '', status: 'ok', note: 'no frames' }]
  return d.frames.map((f) => ({
    time,
    proto,
    tool,
    out: '',
    in: canFrameText(f.id, f.data, f.ext, f.rtr),
    status: 'ok' as const,
    note: `received at ${f.ts_ms} ms${f.fd ? `, FD${f.brs ? ' + BRS' : ''}` : ''}`,
  }))
}

/** A BenchCall that also logs each call that is not a poll (and every CAN frame read, polled or not). */
export function loggedCall(call: BenchCall, proto: BusProto, add: (row: Omit<BusLogRow, 'id'>) => void, only?: (tool: string) => boolean): BenchCall {
  return async (tool, args = {}, opts) => {
    const r = await call(tool, args, opts)
    if (!only || only(tool)) for (const row of logRows(Date.now(), proto, tool, args, r, !!opts?.poll)) add(row)
    return r
  }
}
