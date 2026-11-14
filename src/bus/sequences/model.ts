import type { BusLogRow, BusProto } from '../busLog'

// A saved sequence: log rows of the bus console kept as the MCP calls they were (the tool and
// its arguments), with what each read saw when it was recorded. The same JSON goes to the server
// (embeddedci.com) and to the desktop app's local file; `version` says which format it is.
//
// Version 2 adds setup steps: when the selected rows used a bus session opened earlier in the log
// (an I2C, CAN or UART session, GPIO modes), the sequence starts with the calls that open it the way
// it was recorded (pins, rate, pull-ups, bitrate, modes), marked `setup: true`. A run makes them
// first, and the pytest export writes them as its setup. Version 1 sequences have none and still
// load, run and export as before.

export const SEQUENCE_VERSION = 2

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
  /** Version 2: a call the sequence starts with to set the bus up as it was recorded (not a selected row). */
  setup?: boolean
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

/**
 * Steps from the selected rows, oldest first (the order they ran), after the setup steps that
 * open the sessions they used but did not open themselves (see setupFromRows).
 */
export function stepsFromRows(rows: BusLogRow[], selected: ReadonlySet<number>): SequenceStep[] {
  const steps = [...rows]
    .filter((r) => selected.has(r.id))
    .sort(byTime)
    .map(stepFromRow)
    .filter((s): s is SequenceStep => s !== null)
  return steps.length ? [...setupFromRows(rows, selected, steps), ...steps] : steps
}

const byTime = (a: BusLogRow, b: BusLogRow) => a.time - b.time || a.id - b.id

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const laArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

/** The bus state the log rows before the selection left: open sessions and GPIO modes. */
type BusState = {
  i2c?: { sda?: unknown; scl?: unknown; hz?: number; pullups: string }
  can?: Record<string, unknown>
  uart?: Record<string, unknown>
  gpio: Map<string, { la: unknown; mode: string; level?: number }>
}

function stateBefore(rows: BusLogRow[], first: BusLogRow): BusState {
  const st: BusState = { gpio: new Map() }
  for (const r of [...rows].sort(byTime)) {
    if (byTime(r, first) >= 0) break
    if (!r.args || r.status === 'error' || r.status === 'declined') continue
    const a = r.args
    const d = (r.data ?? {}) as Record<string, unknown>
    switch (r.tool) {
      case 'i2c_open':
        // The pod's answer has the pins and rate it used, also when they came from the wiring.
        st.i2c = { sda: num(d.sda) ?? a.sda, scl: num(d.scl) ?? a.scl, hz: num(d.hz) ?? num(a.hz), pullups: String(d.pullups ?? a.pullups ?? 'pod') }
        break
      case 'i2c_close':
        st.i2c = undefined
        break
      case 'can_open': {
        const c: Record<string, unknown> = {}
        for (const k of ['bitrate', 'mode', 'term', 'data_bitrate']) if (a[k] !== undefined && a[k] !== null) c[k] = a[k]
        st.can = c
        break
      }
      case 'can_close':
        st.can = undefined
        break
      case 'uart_open': {
        const u: Record<string, unknown> = {}
        for (const k of ['rx', 'tx', 'baud']) {
          const v = num(d[k]) ?? a[k]
          if (v !== undefined && v !== null) u[k] = v
        }
        st.uart = u
        break
      }
      case 'uart_close':
        st.uart = undefined
        break
      case 'gpio_mode': {
        const mode = String(a.mode ?? 'output')
        for (const la of laArr(a.la)) st.gpio.set(String(la), { la, mode, level: mode === 'input' ? undefined : num(a.level) })
        break
      }
      case 'gpio_write':
        for (const la of laArr(a.la)) {
          const g = st.gpio.get(String(la))
          if (g && g.mode !== 'input') g.level = Number(a.level)
        }
        break
      case 'gpio_release':
        if (!laArr(a.la).length) st.gpio.clear()
        for (const la of laArr(a.la)) st.gpio.delete(String(la))
        break
    }
  }
  return st
}

type Need = 'i2c' | 'can' | 'uart'

/** The session a step uses without opening it, or the one it opens or closes. */
function sessionOf(s: SequenceStep): { uses?: Need; opens?: Need } {
  switch (s.tool) {
    case 'i2c_open':
    case 'i2c_close':
      return { opens: 'i2c' }
    case 'i2c_transfer':
    case 'i2c_scan':
      return { uses: 'i2c' }
    case 'capture_la':
      return (s.args?.send as { bus?: string } | undefined)?.bus === 'i2c' ? { uses: 'i2c' } : {}
    case 'can_open':
    case 'can_close':
      return { opens: 'can' }
    case 'can_write':
    case 'can_read':
      return { uses: 'can' }
    case 'uart_open':
    case 'uart_close':
      return { opens: 'uart' }
    case 'uart_write':
      return { uses: 'uart' }
    default:
      return {}
  }
}

/** GPIO channels a step drives (they must be outputs); a gpio_mode or gpio_release sets them itself. */
function gpioOf(s: SequenceStep): { drives: unknown[]; sets: unknown[] } {
  const a = s.args ?? {}
  if (s.tool === 'gpio_write' || s.tool === 'gpio_pulse') return { drives: laArr(a.la), sets: [] }
  if (s.tool === 'capture_la') {
    const send = a.send as { bus?: string; la?: unknown } | undefined
    return send?.bus === 'gpio' ? { drives: laArr(send.la), sets: [] } : { drives: [], sets: [] }
  }
  if (s.tool === 'gpio_mode' || s.tool === 'gpio_release') return { drives: [], sets: laArr(a.la) }
  return { drives: [], sets: [] }
}

/**
 * The setup steps for a selection: the calls that put the bus where the earlier, unselected log
 * rows left it, for the sessions and GPIO channels the selected steps use without opening or
 * claiming them first. An I2C session on the pod's pull-ups also gets the set_pull it needs.
 */
export function setupFromRows(rows: BusLogRow[], selected: ReadonlySet<number>, steps: SequenceStep[]): SequenceStep[] {
  const first = [...rows].filter((r) => selected.has(r.id)).sort(byTime)[0]
  if (!first) return []
  const st = stateBefore(rows, first)
  const need = new Set<Need>()
  const opened = new Set<Need>()
  const gpioNeed = new Map<string, unknown>()
  const gpioSet = new Set<string>()
  for (const s of steps) {
    const { uses, opens } = sessionOf(s)
    if (opens) opened.add(opens)
    if (uses && !opened.has(uses)) need.add(uses)
    const g = gpioOf(s)
    for (const la of g.sets) gpioSet.add(String(la))
    for (const la of g.drives) if (!gpioSet.has(String(la))) gpioNeed.set(String(la), la)
  }
  const out: SequenceStep[] = []
  if (need.has('i2c') && st.i2c) {
    const { sda, scl, hz, pullups } = st.i2c
    if (pullups === 'pod' && sda !== undefined && scl !== undefined) out.push({ tool: 'set_pull', args: { las: [sda, scl], enabled: true }, proto: 'I2C', setup: true })
    const args: Record<string, unknown> = {}
    if (sda !== undefined) args.sda = sda
    if (scl !== undefined) args.scl = scl
    if (hz !== undefined) args.hz = hz
    args.pullups = pullups
    out.push({ tool: 'i2c_open', args, proto: 'I2C', setup: true })
  }
  // A selected i2c_open on the pod's pull-ups with no set_pull before it: the pull-ups were on
  // from elsewhere (the pin strip, an earlier row), so the setup switches them on.
  if (!out.length) {
    const sel = [...rows].filter((r) => selected.has(r.id) && r.args && r.status !== 'error' && r.status !== 'declined').sort(byTime)
    const open = sel.find((r) => r.tool === 'i2c_open' || r.tool === 'set_pull')
    const d = (open?.data ?? {}) as Record<string, unknown>
    if (open?.tool === 'i2c_open' && String(d.pullups ?? open.args?.pullups ?? 'pod') === 'pod') {
      const sda = num(d.sda) ?? open.args?.sda
      const scl = num(d.scl) ?? open.args?.scl
      if (sda !== undefined && scl !== undefined) out.push({ tool: 'set_pull', args: { las: [sda, scl], enabled: true }, proto: 'I2C', setup: true })
    }
  }
  if (need.has('can') && st.can) out.push({ tool: 'can_open', args: { ...st.can }, proto: 'CAN', setup: true })
  if (need.has('uart') && st.uart) out.push({ tool: 'uart_open', args: { ...st.uart }, proto: 'UART', setup: true })
  // One gpio_mode per mode and starting level, in channel order.
  const groups = new Map<string, { mode: string; level?: number; las: unknown[] }>()
  for (const [key, la] of gpioNeed) {
    const g = st.gpio.get(key)
    if (!g) continue
    const k = `${g.mode}/${g.level ?? ''}`
    const grp = groups.get(k) ?? { mode: g.mode, level: g.level, las: [] }
    grp.las.push(la)
    groups.set(k, grp)
  }
  for (const grp of groups.values()) {
    const args: Record<string, unknown> = { la: grp.las, mode: grp.mode }
    if (grp.level !== undefined) args.level = grp.level
    out.push({ tool: 'gpio_mode', args, proto: 'GPIO', setup: true })
  }
  return out
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
