// The wiring profile seen pin by pin: what each of LA1..LA14 is used for, its pull resistor, and
// the edits the Pins editor makes. The profile itself keeps its stored form (uart_rx: 5,
// signals: [...]); this is only how the editor reads and changes it, so every host, the SDK and
// the pod keep working with the same keys.

import {
  sharesPin,
  canonicalPulls,
  LA_CHANNEL_COUNT,
  LA_PULLS,
  pullDirections,
  WIRING_ROLES,
  WIRING_ROLE_LABELS,
  withDutDir,
  type LaPull,
  type PullDir,
  type Wiring,
  type WiringDirection,
  type WiringRole,
  type WiringSignal,
} from './model'

/** What a pin can be used for, grouped the way the editor shows them. */
export type PinKind = 'uart' | 'i2c' | 'swd' | 'jtag' | 'spi' | 'signal'

export function roleKind(role: WiringRole): PinKind {
  return role.split('_')[0] as PinKind
}

/** The roles in the "Used for" list, with labels from the board's side where it helps. */
export const PIN_ROLE_OPTIONS: { role: WiringRole; label: string }[] = [
  { role: 'uart_rx', label: 'UART RX (board TX)' },
  { role: 'uart_tx', label: 'UART TX (board RX)' },
  { role: 'i2c_sda', label: 'I2C SDA' },
  { role: 'i2c_scl', label: 'I2C SCL' },
  { role: 'swd_swclk', label: 'SWD clock (SWCLK)' },
  { role: 'swd_swdio', label: 'SWD data (SWDIO)' },
  { role: 'jtag_tck', label: 'JTAG clock (TCK)' },
  { role: 'jtag_tms', label: 'JTAG mode (TMS)' },
  { role: 'jtag_tdi', label: 'JTAG data in (TDI)' },
  { role: 'jtag_tdo', label: 'JTAG data out (TDO)' },
  { role: 'jtag_trst', label: 'JTAG reset (nTRST)' },
  { role: 'spi_sclk', label: 'SPI clock (SCLK)' },
  { role: 'spi_mosi', label: 'SPI MOSI' },
  { role: 'spi_miso', label: 'SPI MISO' },
  { role: 'spi_cs', label: 'SPI chip select (CS)' },
]

/** What the pod does with a signal: the one direction choice a signal has. */
export type SignalUse = 'reads' | 'drives' | 'both'
export const SIGNAL_USE_LABELS: Record<SignalUse, string> = {
  reads: 'reads it (a board output)',
  drives: 'drives it (a board input)',
  both: 'both ways, open drain',
}
const SIGNAL_USE_DIRECTION: Record<SignalUse, WiringDirection> = { reads: 'input', drives: 'output', both: 'open_drain' }

export function signalUse(s: Pick<WiringSignal, 'direction'>): SignalUse {
  if (s.direction === 'output') return 'drives'
  if (s.direction === 'open_drain' || s.direction === 'bidir') return 'both'
  return 'reads'
}

/** One thing the profile puts on a pin. */
export type PinUser = { kind: 'role'; role: WiringRole; label: string } | { kind: 'signal'; index: number; signal: WiringSignal; label: string }

export type PinView = {
  la: number
  /** Everything the profile puts here: one entry normally, none when free, two or more on a conflict. */
  users: PinUser[]
  /** The kind of the first user (for the color), null when free. */
  kind: PinKind | null
  /** Short text for the pin tile: "UART RX", "READY", "free". */
  short: string
  pull: LaPull
  /** The profile switches this pin's pull resistor on (false also when the profile leaves pulls alone). */
  pullOn: boolean
  /** The direction the profile pulls this pin, null when off or not set. */
  pullDir: PullDir | null
}

function usersOf(w: Wiring, la: number): PinUser[] {
  const out: PinUser[] = []
  for (const role of WIRING_ROLES) if (w[role] === la) out.push({ kind: 'role', role, label: WIRING_ROLE_LABELS[role] })
  w.signals.forEach((s, index) => {
    if (s.la === la) out.push({ kind: 'signal', index, signal: s, label: s.name || `signal ${index + 1}` })
  })
  return out
}

/** LA1..LA14 as the editor shows them. */
export function pinViews(w: Wiring): PinView[] {
  const dirs = pullDirections(w.pulls)
  return LA_PULLS.map((pull) => {
    const users = usersOf(w, pull.la)
    const first = users[0]
    return {
      la: pull.la,
      users,
      kind: first ? (first.kind === 'role' ? roleKind(first.role) : 'signal') : null,
      short: users.length ? users.map((u) => u.label).join(' / ') : 'free',
      pull,
      pullOn: dirs.has(pull.la),
      pullDir: dirs.get(pull.la) ?? null,
    }
  })
}

/** "none", a role key, or "signal": the value of a pin's "Used for" choice. */
export type PinUseChoice = 'none' | 'signal' | WiringRole

export function pinUseChoice(p: PinView): PinUseChoice {
  const u = p.users[0]
  if (!u) return 'none'
  return u.kind === 'role' ? u.role : 'signal'
}

/** A signal name nothing in the profile uses yet: SIGNAL1, SIGNAL2, ... */
export function nextSignalName(signals: WiringSignal[]): string {
  const taken = new Set(signals.map((s) => s.name.toLowerCase()))
  for (let n = 1; ; n += 1) {
    const name = `SIGNAL${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/** The profile change that frees a pin: its roles become not wired, its signals are removed. */
function clearPin(w: Wiring, la: number): Partial<Wiring> {
  const patch: Partial<Wiring> = {}
  for (const role of WIRING_ROLES) if (w[role] === la) (patch as Record<string, unknown>)[role] = null
  const gone = w.signals.filter((s) => s.la === la)
  if (gone.length) {
    patch.signals = w.signals.filter((s) => s.la !== la)
    let dirs = w.dut_dirs
    for (const s of gone) if (s.name) dirs = withDutDir({ dut_dirs: dirs }, s.name, undefined)
    patch.dut_dirs = dirs
  }
  return patch
}

/**
 * The profile change that gives a pin one use. Whatever was on the pin goes; a role moves here
 * from the pin it was on (that pin becomes free); a new signal gets a free name, and the pod
 * reads it until it is told otherwise. Keeping a pin's current use changes nothing.
 */
export function assignPin(w: Wiring, la: number, use: PinUseChoice): Partial<Wiring> {
  if (la < 1 || la > LA_CHANNEL_COUNT) return {}
  const view = pinViews(w)[la - 1]
  if (view.users.length === 1 && pinUseChoice(view) === use) return {}
  // SWCLK/TCK and SWDIO/TMS may share a pin: adding one to the other's pin keeps both.
  if (use !== 'none' && use !== 'signal' && view.users.length > 0 && view.users.every((u) => u.kind === 'role' && (u.role === use || sharesPin(u.role, use)))) {
    return view.users.some((u) => u.kind === 'role' && u.role === use) ? {} : { [use]: la }
  }
  const patch = clearPin(w, la)
  if (use === 'none') return patch
  if (use === 'signal') {
    const signals = patch.signals ?? w.signals
    return { ...patch, signals: [...signals, { name: nextSignalName(signals), la, direction: 'input', active_low: false, description: '' }] }
  }
  return { ...patch, [use]: la }
}

/** The profile change that renames, re-directs or otherwise edits the signal at `index`. */
export function updateSignal(w: Wiring, index: number, change: Partial<Pick<WiringSignal, 'name' | 'direction'>> & { use?: SignalUse }): Partial<Wiring> {
  const old = w.signals[index]
  if (!old) return {}
  const { use, ...rest } = change
  const next: WiringSignal = { ...old, ...rest, ...(use ? { direction: SIGNAL_USE_DIRECTION[use] } : {}) }
  const patch: Partial<Wiring> = { signals: w.signals.map((s, i) => (i === index ? next : s)) }
  // A renamed signal keeps its older direction override, if it had one.
  if (change.name !== undefined && old.name && old.name !== change.name) {
    const key = Object.keys(w.dut_dirs ?? {}).find((k) => k.toLowerCase() === old.name.toLowerCase())
    if (key) patch.dut_dirs = withDutDir({ dut_dirs: withDutDir(w, old.name, undefined) }, change.name, w.dut_dirs[key])
  }
  // The pod's choice decides the direction now: an older override for this signal would contradict it.
  if (use && old.name) patch.dut_dirs = withDutDir({ dut_dirs: patch.dut_dirs ?? w.dut_dirs }, next.name || old.name, undefined)
  return patch
}

/**
 * The profile change that pulls one pin `dir` ("up" / "down"), or switches its pull off (null).
 * `true` is the pin's own direction. Written as the list of channels while every pull is its
 * channel's own direction, so older readers keep working.
 */
export function setPinPull(w: Wiring, la: number, dir: PullDir | null | boolean): Partial<Wiring> {
  const pull = LA_PULLS[la - 1]
  if (!pull?.dir) return {}
  const want = dir === true ? pull.dir : dir === false ? null : dir
  const dirs = pullDirections(w.pulls)
  if (want) dirs.set(la, want)
  else dirs.delete(la)
  return { pulls: canonicalPulls(dirs) }
}

/**
 * The directions a pin can pull: the pod's own answer when it is connected (la_pins `pull_dirs`,
 * firmware with la_pull_dir; older firmware names one direction in `pull`), else today's table.
 */
export function pinPullDirs(pull: LaPull, live?: { pull?: string | null; pull_dirs?: string[] | null } | null): PullDir[] {
  if (live && Array.isArray(live.pull_dirs)) return live.pull_dirs.filter((d): d is PullDir => d === 'up' || d === 'down')
  if (live && (live.pull === 'up' || live.pull === 'down')) return [live.pull]
  if (live && live.pull === null) return []
  return pull.dirs
}

/** "Pull-up (4.7k)" / "Pull-down (10k)": the switch label for a pin's resistor; null when it has none. */
export function pullSwitchLabel(p: LaPull, dirs: PullDir[] = p.dirs): string | null {
  if (!dirs.length) return null
  return `Pull-${dirs.join('/')}${p.ohms ? ` (${p.ohms})` : ''}`
}
