
// The bench's wiring profile (schema v1), shared by the EmbeddedCI web app and the desktop app: the
// same keys, defaults and checks as the Python SDK's Wiring and the server.
//
/**
 * Per-device wiring profile (schema v1): the bench's single description of which DUT signal is on
 * which LA channel, plus baud / I2C address / SWD target / target-power rail. Persisted server-side
 * on the org-owned device (parameter `wiring`), so it's shared across the org and survives browser
 * changes — set your bench wiring once and every tab, session, user and the Python SDK (`bp.wiring`)
 * reads the same profile. Loaded on first use, saved (debounced) on change.
 *
 * Two views of it:
 * - the STORED object is what the server holds: any subset of the keys. A key that is absent takes
 *   its default; a pin key set to `null` means "not wired" (overrides the default).
 * - the EFFECTIVE profile (`Wiring`) is the defaults overlaid with the stored object. That's what
 *   every consumer reads.
 */
/** One problem with a profile key (the server's and the SDK's field names). */
export type WiringFieldIssue = { field: string; message: string }

/** A measured DAC-to-output point of the control loop's output stage. */
export type StageCalPoint = { dac_v: number; out_v: number }
export const MAX_STAGE_CAL_POINTS = 8

// The control loop's defaults (the reference solar bench), as the web app's Generator tab sets them.
const DEFAULT_LOOP_INPUT = { unit: 'mA', mvAtZero: 0, mvPerUnit: 2.0, min: 0, max: 1000 }
const DEFAULT_OUTPUT_STAGE = {
  enabled: false,
  path: '5v' as const,
  inverted: true,
  cal: [
    { dac_v: 3.3, out_v: 3.55 },
    { dac_v: 2.6, out_v: 12.44 },
    { dac_v: 1.9, out_v: 21.33 },
  ],
  maxOutV: 22,
  dacMinV: 0,
  dacMaxV: 3.6,
  slewVPerMs: 0.1,
  maxInput: 3000,
}

export type WiringDirection = 'input' | 'output' | 'open_drain' | 'bidir'
export const WIRING_DIRECTIONS: WiringDirection[] = ['input', 'output', 'open_drain', 'bidir']

/** A named DUT signal on an LA channel that isn't one of the fixed roles (e.g. TRIGGER on LA9). */
export type WiringSignal = {
  name: string
  la: number
  direction: WiringDirection
  active_low: boolean
  description: string
}

export type Wiring = {
  version: number
  /** LA I/O-bank voltage in mV (1800 or 3300). Must be set on the pod before any LA op. */
  la_mv: number
  /** Target-power eFuse: 1 = internal 5 V, 2 = external. */
  efuse: number
  /** LA channel the pod samples (wire the DUT's TX here); null = not wired. */
  uart_rx: number | null
  /** LA channel the pod drives (the DUT's RX); null = not wired. */
  uart_tx: number | null
  uart_baud: number
  i2c_sda: number | null
  i2c_scl: number | null
  i2c_addr: string
  swd_swclk: number | null
  swd_swdio: number | null
  /** true = the DUT's reset is wired to the pod's reset pin (J1 pin 22, rev3 pods). */
  swd_nreset: boolean
  /** OpenOCD target config, e.g. `target/stm32f4x.cfg`. */
  swd_target: string
  spi_sclk: number | null
  spi_mosi: number | null
  spi_miso: number | null
  spi_cs: number | null
  signals: WiringSignal[]
  /**
   * The control loop's INPUT sense chain — what the ADC is actually wired to, so the loop can
   * be configured in the unit the bench measures instead of raw ADC codes. Lives here rather
   * than in `cap.*` because it is bench wiring, not something the pod can announce about
   * itself: only the person who soldered the shunt knows it. See loopInputMap.ts.
   *
   * Defaults describe the reference solar bench: a 0.04 Ω shunt into an INA282 (fixed 50 V/V,
   * REF1/REF2 grounded) => 0.04 × 50 = 2.0 mV/mA, zero at 0 mV.
   */
  loop_input_unit: string
  loop_input_mv_at_zero: number
  loop_input_mv_per_unit: number
  loop_input_min: number
  loop_input_max: number
  /**
   * How the operator ENTERS the sensitivity. `mv_per_unit` is the raw figure; `shunt` derives
   * it from the two things actually soldered to the board — see mvPerUnitFromShunt().
   * `loop_input_mv_per_unit` stays the single source of truth either way (it is what the
   * firmware is sent); these two only round-trip the form so re-opening it shows the parts
   * rather than the product.
   */
  loop_input_entry: 'mv_per_unit' | 'shunt'
  loop_input_shunt_mohm: number
  loop_input_gain: number
  /**
   * The control loop's OUTPUT stage — the module the DAC drives (e.g. a solar simulator with an
   * inverted input) and the limits that protect it. Bench wiring for the same reason as the input
   * keys: only the bench knows what is on the DAC. See loopOutputStage.ts.
   */
  loop_output_enabled: boolean
  /** The DAC output the stage is wired to. The loop is locked to it, and Stop parks it. */
  loop_output_path: '3v3' | '5v' | '12v'
  /** true = 0 V on the DAC is the module's FULL output. The calibration must agree. */
  loop_output_inverted: boolean
  loop_output_cal: StageCalPoint[]
  loop_output_max_v: number
  loop_output_dac_min_v: number
  loop_output_dac_max_v: number
  loop_output_slew_v_per_ms: number
  loop_output_max_input: number
}

/** What the server stores: any subset of the profile (absent → default, pin null → not wired). */
export type StoredWiring = Partial<Wiring>

/** The pin roles, in the order conflicts are reported (the first user of a channel "owns" it). */
export const WIRING_ROLES = [
  'uart_rx',
  'uart_tx',
  'i2c_sda',
  'i2c_scl',
  'swd_swclk',
  'swd_swdio',
  'spi_sclk',
  'spi_mosi',
  'spi_miso',
  'spi_cs',
] as const
export type WiringRole = (typeof WIRING_ROLES)[number]

/** Short human labels for the roles, as shown on channel labels ("LA5 · UART RX"). */
export const WIRING_ROLE_LABELS: Record<WiringRole, string> = {
  uart_rx: 'UART RX',
  uart_tx: 'UART TX',
  i2c_sda: 'I2C SDA',
  i2c_scl: 'I2C SCL',
  swd_swclk: 'SWCLK',
  swd_swdio: 'SWDIO',
  spi_sclk: 'SPI SCLK',
  spi_mosi: 'SPI MOSI',
  spi_miso: 'SPI MISO',
  spi_cs: 'SPI CS',
}

export const LA_CHANNEL_COUNT = 14
export const MAX_WIRING_SIGNALS = 14

/** The fixed pull resistor on one LA channel. 3V3-referenced: unavailable while the bank is at 1.8 V. */
export type LaPull = { la: number; dir: 'up' | 'down' | null; ohms: string | null }

export const LA_PULLS: LaPull[] = Array.from({ length: LA_CHANNEL_COUNT }, (_, i) => {
  const la = i + 1
  if (la <= 2) return { la, dir: 'up', ohms: '4.7k' }
  if (la <= 4) return { la, dir: 'up', ohms: '2.2k' }
  if (la <= 6) return { la, dir: 'up', ohms: '10k' }
  if (la <= 8) return { la, dir: 'down', ohms: '10k' }
  return { la, dir: null, ohms: null }
})

/** "pull-up 4.7k", "pull-down 10k" or "none": the resistor on one LA channel. */
export function pullLabel(p: LaPull): string {
  if (!p.dir) return 'none'
  return `pull-${p.dir} ${p.ohms ?? ''}`.trim()
}

export const WIRING_DEFAULTS: Wiring = {
  version: 1,
  la_mv: 3300,
  efuse: 1,
  uart_rx: 5,
  uart_tx: 4,
  uart_baud: 115200,
  i2c_sda: 1,
  i2c_scl: 2,
  i2c_addr: '0x76',
  swd_swclk: 11,
  swd_swdio: 12,
  swd_nreset: false,
  swd_target: '',
  spi_sclk: null,
  spi_mosi: null,
  spi_miso: null,
  spi_cs: null,
  signals: [],
  loop_input_unit: DEFAULT_LOOP_INPUT.unit,
  loop_input_mv_at_zero: DEFAULT_LOOP_INPUT.mvAtZero,
  loop_input_mv_per_unit: DEFAULT_LOOP_INPUT.mvPerUnit,
  loop_input_min: DEFAULT_LOOP_INPUT.min,
  loop_input_max: DEFAULT_LOOP_INPUT.max,
  loop_input_entry: 'mv_per_unit',
  loop_input_shunt_mohm: 40, // reference bench: 0.04 Ω …
  loop_input_gain: 50, // … into an INA282's fixed 50 V/V
  loop_output_enabled: DEFAULT_OUTPUT_STAGE.enabled,
  loop_output_path: DEFAULT_OUTPUT_STAGE.path,
  loop_output_inverted: DEFAULT_OUTPUT_STAGE.inverted,
  loop_output_cal: DEFAULT_OUTPUT_STAGE.cal,
  loop_output_max_v: DEFAULT_OUTPUT_STAGE.maxOutV,
  loop_output_dac_min_v: DEFAULT_OUTPUT_STAGE.dacMinV,
  loop_output_dac_max_v: DEFAULT_OUTPUT_STAGE.dacMaxV,
  loop_output_slew_v_per_ms: DEFAULT_OUTPUT_STAGE.slewVPerMs,
  loop_output_max_input: DEFAULT_OUTPUT_STAGE.maxInput,
}
const DEFAULTS = WIRING_DEFAULTS

/** The control-loop keys: part of the stored object, but owned by the Generator tab, not the editor. */
export const LOOP_INPUT_KEYS = [
  'loop_input_unit',
  'loop_input_mv_at_zero',
  'loop_input_mv_per_unit',
  'loop_input_min',
  'loop_input_max',
  'loop_input_entry',
  'loop_input_shunt_mohm',
  'loop_input_gain',
  'loop_output_enabled',
  'loop_output_path',
  'loop_output_inverted',
  'loop_output_cal',
  'loop_output_max_v',
  'loop_output_dac_min_v',
  'loop_output_dac_max_v',
  'loop_output_slew_v_per_ms',
  'loop_output_max_input',
] as const

const PIN_KEYS = new Set<string>(WIRING_ROLES)
const KNOWN_KEYS = new Set<string>(Object.keys(DEFAULTS))
const SIGNAL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/

function isCalPoint(v: unknown): v is StageCalPoint {
  return (
    isRecord(v) &&
    typeof v.dac_v === 'number' && Number.isFinite(v.dac_v) &&
    typeof v.out_v === 'number' && Number.isFinite(v.out_v)
  )
}

function isLaChannel(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LA_CHANNEL_COUNT
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Pick only known profile keys with a usable type out of a JSON object (e.g. the server's stored
 * wiring). Pin keys keep `null` ("not wired"); anything malformed is dropped so it takes its default.
 */
export function coerceStoredWiring(remote: Record<string, unknown>): StoredWiring {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(remote)) {
    if (!KNOWN_KEYS.has(k)) continue
    if (PIN_KEYS.has(k)) {
      if (v === null || isLaChannel(v)) out[k] = v
      continue
    }
    const d = (DEFAULTS as Record<string, unknown>)[k]
    if (k === 'signals') {
      if (Array.isArray(v)) out.signals = v.filter(isRecord).map(coerceSignal)
    } else if (k === 'loop_input_entry') {
      if (v === 'shunt' || v === 'mv_per_unit') out[k] = v
    } else if (k === 'loop_output_path') {
      if (v === '3v3' || v === '5v' || v === '12v') out[k] = v
    } else if (k === 'loop_output_cal') {
      if (Array.isArray(v) && v.length <= MAX_STAGE_CAL_POINTS && v.every(isCalPoint))
        out[k] = v.map((p) => ({ dac_v: p.dac_v, out_v: p.out_v }))
    } else if (typeof d === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    } else if (typeof v === typeof d) {
      out[k] = v
    }
  }
  return out as StoredWiring
}

function coerceSignal(s: Record<string, unknown>): WiringSignal {
  return {
    name: typeof s.name === 'string' ? s.name : '',
    la: typeof s.la === 'number' ? s.la : 0,
    direction: WIRING_DIRECTIONS.includes(s.direction as WiringDirection) ? (s.direction as WiringDirection) : 'input',
    active_low: s.active_low === true,
    description: typeof s.description === 'string' ? s.description : '',
  }
}

/** Effective profile: defaults overlaid with the stored object (absent → default, pin null → not wired). */
export function effectiveWiring(stored: Record<string, unknown>): Wiring {
  return { ...DEFAULTS, ...coerceStoredWiring(stored) }
}

export type WiringIssues = { errors: WiringFieldIssue[]; warnings: WiringFieldIssue[] }

type ChannelUser = { id: string; field: string; la: number; kind: 'role' | 'signal'; label: string }

/** Every LA channel assignment in the profile, roles first then signals — the conflict-report order. */
function channelUsers(w: Wiring, skipFields: Set<string> = new Set()): ChannelUser[] {
  const users: ChannelUser[] = []
  for (const role of WIRING_ROLES) {
    const la = w[role]
    if (isLaChannel(la) && !skipFields.has(role)) {
      users.push({ id: role, field: role, la, kind: 'role', label: WIRING_ROLE_LABELS[role] })
    }
  }
  w.signals.forEach((s, i) => {
    const field = `signals[${i}].la`
    if (isLaChannel(s.la) && !skipFields.has(field)) {
      users.push({ id: s.name || `signals[${i}]`, field, la: s.la, kind: 'signal', label: s.name || `signal ${i + 1}` })
    }
  })
  return users
}

/** Pull-resistor warnings for the effective profile (save allowed, reported). */
function pullWarnings(w: Wiring): WiringFieldIssue[] {
  const out: WiringFieldIssue[] = []
  for (const role of ['i2c_sda', 'i2c_scl'] as const) {
    const la = w[role]
    if (!isLaChannel(la)) continue
    if (la >= 9) out.push({ field: role, message: 'no pod pull-up on LA9-LA14; the bus needs external pull-ups' })
    else if (la === 7 || la === 8)
      out.push({ field: role, message: 'LA7/LA8 have 10k pull-downs; keep them disabled on an open-drain bus' })
  }
  if (w.uart_rx === 7 || w.uart_rx === 8) {
    out.push({ field: 'uart_rx', message: 'LA7/LA8 have pull-downs; the UART idles high — keep the pull disabled' })
  }
  return out
}

/**
 * Client-side validation mirroring the server's (spec §1): errors reject the save, warnings are
 * reported. `raw` is a stored object (or anything shaped like one, e.g. a pasted wiring.json).
 * Field names match the server's `fields[]` (`uart_tx`, `signals[2].la`).
 */
export function validateWiring(raw: Record<string, unknown>): WiringIssues {
  const errors: WiringFieldIssue[] = []
  const err = (field: string, message: string) => errors.push({ field, message })
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined

  for (const k of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(k) && raw[k] !== undefined) err(k, `unknown key "${k}"; remove it`)
  }
  if (has('version') && raw.version !== 1) err('version', 'version must be 1')
  if (has('la_mv') && raw.la_mv !== 1800 && raw.la_mv !== 3300)
    err('la_mv', 'la_mv must be 1800 or 3300 (the LA bank voltage in mV)')
  if (has('efuse') && raw.efuse !== 1 && raw.efuse !== 2) err('efuse', 'efuse must be 1 (Internal 5 V, eFuse 1) or 2 (External, eFuse 2)')
  for (const role of WIRING_ROLES) {
    if (has(role) && raw[role] !== null && !isLaChannel(raw[role]))
      err(role, `${role} must be an LA channel 1-${LA_CHANNEL_COUNT}, or null when it isn't wired`)
  }
  if (has('uart_baud')) {
    const b = raw.uart_baud
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 300 || b > 4000000)
      err('uart_baud', 'uart_baud must be a whole number between 300 and 4000000')
  }
  if (has('i2c_addr')) {
    const a = raw.i2c_addr
    const n = typeof a === 'string' && /^0x[0-9a-f]{1,2}$/i.test(a.trim()) ? Number.parseInt(a.trim().slice(2), 16) : NaN
    if (!(n >= 0x03 && n <= 0x77)) err('i2c_addr', 'i2c_addr must be a 7-bit hex address from 0x03 to 0x77, e.g. "0x76"')
  }
  if (has('swd_nreset') && typeof raw.swd_nreset !== 'boolean') err('swd_nreset', 'swd_nreset must be true or false')
  if (has('swd_target')) {
    if (typeof raw.swd_target !== 'string') err('swd_target', 'swd_target must be a string, e.g. "target/stm32f4x.cfg"')
    else if (raw.swd_target.length > 128) err('swd_target', 'swd_target must be at most 128 characters')
  }
  for (const k of LOOP_INPUT_KEYS) {
    if (!has(k)) continue
    const v = raw[k]
    if (k === 'loop_input_unit') {
      if (typeof v !== 'string') err(k, `${k} must be a string`)
    } else if (k === 'loop_input_entry') {
      if (v !== 'mv_per_unit' && v !== 'shunt') err(k, `${k} must be "mv_per_unit" or "shunt"`)
    } else if (k === 'loop_output_enabled' || k === 'loop_output_inverted') {
      if (typeof v !== 'boolean') err(k, `${k} must be true or false`)
    } else if (k === 'loop_output_path') {
      if (v !== '3v3' && v !== '5v' && v !== '12v') err(k, `${k} must be "3v3", "5v" or "12v"`)
    } else if (k === 'loop_output_cal') {
      if (!Array.isArray(v) || v.length > MAX_STAGE_CAL_POINTS || !v.every(isCalPoint))
        err(k, `${k} must be a list of up to ${MAX_STAGE_CAL_POINTS} {"dac_v", "out_v"} number pairs`)
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      err(k, `${k} must be a number`)
    }
  }

  if (has('signals')) {
    const sigs = raw.signals
    if (!Array.isArray(sigs)) {
      err('signals', 'signals must be a list')
    } else {
      if (sigs.length > MAX_WIRING_SIGNALS) err('signals', `signals can hold at most ${MAX_WIRING_SIGNALS} entries (one per LA channel)`)
      const seen = new Map<string, number>()
      sigs.forEach((s, i) => {
        const p = `signals[${i}]`
        if (!isRecord(s)) {
          err(p, `${p} must be an object with a name and an la channel`)
          return
        }
        if (typeof s.name !== 'string' || !SIGNAL_NAME_RE.test(s.name)) {
          err(`${p}.name`, `${p}.name must start with a letter and use only letters, digits and _ (at most 32 characters)`)
        } else if ((WIRING_ROLES as readonly string[]).includes(s.name.toLowerCase())) {
          err(`${p}.name`, `${p}.name "${s.name}" is a role name; pick a different name`)
        } else {
          const prev = seen.get(s.name.toLowerCase())
          if (prev !== undefined) err(`${p}.name`, `${p}.name "${s.name}" is already used by signals[${prev}]`)
          else seen.set(s.name.toLowerCase(), i)
        }
        if (!isLaChannel(s.la)) err(`${p}.la`, `${p}.la must be an LA channel 1-${LA_CHANNEL_COUNT}`)
        if (s.direction !== undefined && !WIRING_DIRECTIONS.includes(s.direction as WiringDirection))
          err(`${p}.direction`, `${p}.direction must be one of input, output, open_drain, bidir`)
        if (s.active_low !== undefined && typeof s.active_low !== 'boolean')
          err(`${p}.active_low`, `${p}.active_low must be true or false`)
        if (s.description !== undefined) {
          if (typeof s.description !== 'string') err(`${p}.description`, `${p}.description must be a string`)
          else if (s.description.length > 120) err(`${p}.description`, `${p}.description must be at most 120 characters`)
        }
      })
    }
  }

  // Channel conflicts on the effective profile. Fields that already failed type/range checks are left
  // out, so a bad value doesn't also report a phantom conflict with the default it fell back to.
  const eff = effectiveWiring(raw)
  const bad = new Set(errors.map((e) => e.field))
  const byChannel = new Map<number, ChannelUser>()
  for (const u of channelUsers(eff, bad)) {
    const first = byChannel.get(u.la)
    if (first) err(u.field, `LA${u.la} is used by both ${first.id} and ${u.id}`)
    else byChannel.set(u.la, u)
  }

  return { errors, warnings: pullWarnings(eff) }
}

export type LaChannelUser = { kind: 'role' | 'signal'; id: string; label: string; field: string }
export type LaChannelInfo = {
  la: number
  pull: LaPull
  users: LaChannelUser[]
  /** More than one role/signal on this channel — the profile can't be saved like this. */
  conflict: boolean
  warnings: string[]
}

/** Per-LA-channel view of a profile: who uses each of LA1..LA14, its pull resistor, conflicts/warnings. */
export function laChannelMap(w: Wiring): LaChannelInfo[] {
  const users = channelUsers(w)
  const warnings = pullWarnings(w)
  return LA_PULLS.map((pull) => {
    const here = users.filter((u) => u.la === pull.la)
    const fields = new Set(here.map((u) => u.field))
    return {
      la: pull.la,
      pull,
      users: here.map(({ kind, id, label, field }) => ({ kind, id, label, field })),
      conflict: here.length > 1,
      warnings: warnings.filter((x) => fields.has(x.field)).map((x) => x.message),
    }
  })
}

/** "LA9 · TRIGGER" / "LA1 · I2C SDA" / "LA3" — a channel label with whatever the profile puts on it. */
export function laChannelLabel(w: Wiring, la: number): string {
  const names = channelUsers(w)
    .filter((u) => u.la === la)
    .map((u) => u.label)
  return names.length ? `LA${la} · ${names.join(' / ')}` : `LA${la}`
}

/** The fixed pull resistor as a short label: "4.7k pull-up", "10k pull-down", "no pull". */
export function laPullLabel(p: LaPull): string {
  if (!p.dir) return 'no pull'
  return `${p.ohms} pull-${p.dir}`
}

/** Per-field inline error messages: the reported errors plus "LA4 is also used by …" for every user of a
 *  conflicting channel (the error list only names the second user; both inputs should light up). */
export function wiringFieldErrors(w: Wiring, errors: WiringFieldIssue[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of errors) if (!out.has(e.field)) out.set(e.field, e.message)
  for (const ch of laChannelMap(w)) {
    if (!ch.conflict) continue
    for (const u of ch.users) {
      if (out.has(u.field)) continue
      const others = ch.users.filter((o) => o.field !== u.field).map((o) => o.id)
      out.set(u.field, `LA${ch.la} is also used by ${others.join(', ')}`)
    }
  }
  return out
}

/**
 * The profile keys an editor/file cares about — everything except the Generator-owned control-loop
 * keys — as explicit values. Used for "copy as wiring.json".
 */
export function wiringProfileJson(w: Wiring): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(w)) {
    if (!(LOOP_INPUT_KEYS as readonly string[]).includes(k)) out[k] = v
  }
  return out
}

/** The first LA channel nothing in the profile uses (for a new signal), or null when all 14 are taken. */
export function firstFreeLaChannel(w: Wiring): number | null {
  const used = new Set(channelUsers(w).map((u) => u.la))
  for (let la = 1; la <= LA_CHANNEL_COUNT; la += 1) if (!used.has(la)) return la
  return null
}

