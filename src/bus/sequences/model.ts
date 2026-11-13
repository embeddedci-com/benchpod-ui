import type { BusLogRow, BusProto } from '../busLog'

// A saved sequence: log rows of the bus console kept as the MCP calls they were (the tool and
// its arguments), with what each read saw when it was recorded. The same JSON goes to the server
// (embeddedci.com) and to the desktop app's local file; `version` says which format it is.

export const SEQUENCE_VERSION = 1

/** What a step's call returned when it was recorded. Checked on a run, asserted in the pytest export. */
export type StepExpect = {
  /** i2c_transfer, and an I2C send of capture_la: every byte acknowledged. */
  ack?: boolean
  /** i2c_transfer and spi_transfer: the bytes read, hex. capture_la: what its send read. */
  rx_hex?: string
  /** i2c_scan: the addresses that answered. */
  found?: number[]
  /** gpio_read: the level of each channel read. */
  levels?: { la: number; level: number }[]
  /** gpio_wait: the level came within the timeout. */
  reached?: boolean
  /** can_read: the frames received. */
  frames?: { id: number; data: number[] }[]
  /** capture_la with a send: the send ran without an error. */
  send_ok?: boolean
}

export type SequenceStep = {
  /** The MCP tool, e.g. i2c_transfer. */
  tool: string
  args: Record<string, unknown>
  /** For the list: the bus of the log row it came from. */
  proto?: BusProto
  expect?: StepExpect
}

export type BusSequence = {
  /** Server id or the desktop's local id. */
  id: string
  name: string
  version: number
  steps: SequenceStep[]
  /** Shared in the organization (server only). */
  shared?: boolean
  /** False for a sequence another member shared: read-only. */
  mine?: boolean
  owner?: { id: string; name: string }
  created_at?: string
  updated_at?: string
}

/** What a create or update sends. */
export type SequenceInput = { name: string; steps: SequenceStep[]; version?: number; shared?: boolean }

/**
 * Where sequences are kept: embeddedci.com (per user, shareable) or a local file (the desktop
 * app without an account). The host builds it; the panel only calls it.
 */
export type SequenceStore = {
  list: () => Promise<BusSequence[]>
  create: (s: SequenceInput) => Promise<BusSequence>
  update: (id: string, s: Partial<SequenceInput>) => Promise<BusSequence>
  remove: (id: string) => Promise<void>
  /** Whether "share in my organization" is offered (signed in to embeddedci.com, not a guest). */
  canShare?: boolean
  /** Shown under the list: where these are kept. */
  where?: string
}

/** Tools a step can be made of: the bus console's calls that change or read the bus. */
export const SEQUENCE_TOOLS = new Set([
  'set_pull',
  'i2c_open',
  'i2c_close',
  'i2c_transfer',
  'i2c_scan',
  'spi_transfer',
  'gpio_mode',
  'gpio_write',
  'gpio_read',
  'gpio_pulse',
  'gpio_wait',
  'gpio_release',
  'can_open',
  'can_write',
  'can_read',
  'can_close',
  'uart_open',
  'uart_write',
  'uart_close',
  'capture_la',
])

/** The log's bus for a tool, so a run's rows land under the right protocol. */
export function toolProto(tool: string, args?: Record<string, unknown>): 'i2c' | 'spi' | 'can' | 'gpio' | 'uart' {
  if (tool === 'capture_la') {
    const bus = (args?.send as { bus?: string } | undefined)?.bus
    return bus === 'spi' ? 'spi' : bus === 'gpio' ? 'gpio' : 'i2c'
  }
  if (tool.startsWith('i2c_') || tool === 'set_pull') return 'i2c'
  if (tool.startsWith('spi_')) return 'spi'
  if (tool.startsWith('can_')) return 'can'
  if (tool.startsWith('uart_')) return 'uart'
  return 'gpio'
}

type Data = Record<string, unknown> | undefined

/** The expectation a tool's result gives, or undefined when there is nothing to check. */
export function expectFrom(tool: string, data: unknown): StepExpect | undefined {
  const d = data as Data
  if (!d || typeof d !== 'object') return undefined
  switch (tool) {
    case 'i2c_transfer':
      return { ack: !!d.ack, ...(d.rx_hex ? { rx_hex: String(d.rx_hex) } : {}) }
    case 'i2c_scan':
      return Array.isArray(d.found) ? { found: (d.found as unknown[]).map(Number) } : undefined
    case 'spi_transfer':
      return typeof d.rx_hex === 'string' ? { rx_hex: d.rx_hex } : undefined
    case 'gpio_read':
      return Array.isArray(d.levels) ? { levels: (d.levels as { la: number; level: number }[]).map((l) => ({ la: Number(l.la), level: Number(l.level) })) } : undefined
    case 'gpio_wait':
      return typeof d.reached === 'boolean' ? { reached: d.reached } : undefined
    case 'can_read':
      return Array.isArray(d.frames) ? { frames: (d.frames as { id: number; data: number[] }[]).map((f) => ({ id: Number(f.id), data: (f.data ?? []).map(Number) })) } : undefined
    case 'capture_la': {
      const s = d.send as Data
      if (!s) return undefined
      const out: StepExpect = { send_ok: !s.error && s.ack !== false }
      if (typeof s.ack === 'boolean') out.ack = s.ack
      if (s.rx_hex) out.rx_hex = String(s.rx_hex)
      return out
    }
    default:
      return undefined
  }
}

/** A step from a log row, or null when the row cannot be replayed (failed, not run, no args). */
export function stepFromRow(row: BusLogRow): SequenceStep | null {
  if (!row.args || !SEQUENCE_TOOLS.has(row.tool)) return null
  if (row.status === 'error' || row.status === 'declined') return null
  const step: SequenceStep = { tool: row.tool, args: { ...row.args }, proto: row.proto }
  const expect = expectFrom(row.tool, row.data)
  if (expect) step.expect = expect
  return step
}

/** Steps from the selected rows, oldest first (the order they ran). */
export function stepsFromRows(rows: BusLogRow[], selected: ReadonlySet<number>): SequenceStep[] {
  return [...rows]
    .filter((r) => selected.has(r.id))
    .sort((a, b) => a.time - b.time || a.id - b.id)
    .map(stepFromRow)
    .filter((s): s is SequenceStep => s !== null)
}

const normHex = (h: string | undefined) => (h ?? '').replace(/\s+/g, '').toLowerCase()

/** How a result compares with what was recorded: undefined when it matches or there is nothing to check. */
export function stepDiff(step: SequenceStep, data: unknown): string | undefined {
  const want = step.expect
  if (!want) return undefined
  const got = expectFrom(step.tool, data)
  if (!got) return 'no result to compare'
  if (want.ack !== undefined && got.ack !== want.ack) return want.ack ? 'NACK, recorded ACK' : 'ACK, recorded NACK'
  if (want.rx_hex !== undefined && normHex(got.rx_hex) !== normHex(want.rx_hex)) return `read ${spaced(got.rx_hex)}, recorded ${spaced(want.rx_hex)}`
  if (want.found && JSON.stringify(got.found) !== JSON.stringify(want.found)) return `found ${hexList(got.found)}, recorded ${hexList(want.found)}`
  if (want.levels) {
    for (const l of want.levels) {
      const g = got.levels?.find((x) => x.la === l.la)
      if (g && g.level !== l.level) return `LA${l.la} = ${g.level}, recorded ${l.level}`
    }
  }
  if (want.reached !== undefined && got.reached !== want.reached) return want.reached ? 'timed out, recorded reached' : 'reached, recorded a timeout'
  if (want.frames && JSON.stringify(got.frames) !== JSON.stringify(want.frames)) return `${got.frames?.length ?? 0} frames differ from the recorded ${want.frames.length}`
  if (want.send_ok !== undefined && got.send_ok !== want.send_ok) return want.send_ok ? 'the send failed, recorded ok' : 'the send ran, recorded a failure'
  return undefined
}

function spaced(h: string | undefined): string {
  return normHex(h).match(/../g)?.join(' ') || 'nothing'
}

function hexList(a: number[] | undefined): string {
  return a?.length ? a.map((n) => `0x${n.toString(16).padStart(2, '0')}`).join(' ') : 'none'
}
