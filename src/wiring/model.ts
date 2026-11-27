
// The bench's wiring profile (schema v1), shared by the EmbeddedCI web app and the desktop app: the
// same keys, defaults and checks as the Python SDK's Wiring and the server.
//
/**
 * Per-device wiring profile (schema v1): the bench's single description of which DUT signal is on
 * which LA channel, plus baud / I2C address / SWD target / target-power supply. Persisted server-side
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

/** Which way the DUT's signal goes (the pod's `la_dir`): the pod refuses a push-pull driver on a `dut_output` pin. */
export type WiringDutDir = 'dut_input' | 'dut_output' | 'bidir'
export const WIRING_DUT_DIRS: WiringDutDir[] = ['dut_output', 'dut_input', 'bidir']
/** Short labels for the DUT directions, from the board's side. */
export const WIRING_DUT_DIR_LABELS: Record<WiringDutDir, string> = {
  dut_output: 'board output',
  dut_input: 'board input',
  bidir: 'bidirectional',
}

/** A named DUT signal on an LA channel that isn't one of the fixed roles (e.g. TRIGGER on LA9). */
export type WiringSignal = {
  name: string
  la: number
  direction: WiringDirection
  active_low: boolean
  description: string
}

export type UartParity = 'none' | 'even' | 'odd'

/** The external INA current-monitor chips a profile can list (the SDK attaches them on connect). */
export const MONITOR_CHIPS = ['ina226', 'ina228', 'ina238', 'ina219', 'ina260', 'ina3221'] as const
export type MonitorChip = (typeof MONITOR_CHIPS)[number]
export const MAX_WIRING_MONITORS = 8
/** The averaging counts a chip takes (the INA219 has its own list). */
export const MONITOR_AVERAGING: Record<MonitorChip, number[]> = {
  ina226: [1, 4, 16, 64, 128, 256, 512, 1024],
  ina228: [1, 4, 16, 64, 128, 256, 512, 1024],
  ina238: [1, 4, 16, 64, 128, 256, 512, 1024],
  ina219: [1, 2, 4, 8, 16, 32, 64, 128],
  ina260: [1, 4, 16, 64, 128, 256, 512, 1024],
  ina3221: [1, 4, 16, 64, 128, 256, 512, 1024],
}
/** The INA260 has its own 2 mohm shunt. */
export const INA260_SHUNT_OHM = 0.002

/**
 * One external INA breakout (profile key `monitors`). `addr` is the 7-bit address as a number (64 is
 * 0x40); the optional keys are left out when not set. sda/scl default to the profile's I2C pins.
 */
export type WiringMonitor = {
  chip: MonitorChip
  addr: number
  /** Ohms; required except for the ina260. */
  shunt_ohm?: number
  /** Default `ina226@0x40` (the ina3221 adds `.1`). The power tools select a monitor by this name. */
  name?: string
  /** 1-3, ina3221 only (default 1). */
  channel?: number
  sda?: number
  scl?: number
  averaging?: number
  /** Seconds, up to 0.01. */
  conversion_time?: number
  /** Amps. */
  max_current?: number
}

/** The debug port a board with both SWD and JTAG pins wired is flashed through; null = automatic. */
export type DebugPort = 'swd' | 'jtag'

/** The DUT power output (profile key `supply`): what the DUT gets, not which connector it comes from. */
export type Supply = '5v' | 'external' | '3v3' | '1v8'
export const SUPPLIES: readonly Supply[] = ['5v', 'external', '3v3', '1v8']
/** The two switched supplies of BenchPod v4 (firmware hw fact `supply_3v3_1v8`, J1 pins 17 and 18). */
export const SWITCHED_SUPPLIES: readonly Supply[] = ['3v3', '1v8']
export const isSupply = (v: unknown): v is Supply => SUPPLIES.includes(v as Supply)
export const isSwitchedSupply = (v: unknown): v is Supply => v === '3v3' || v === '1v8'

/** Button and select labels. */
export const SUPPLY_LABELS: Record<Supply, string> = { '5v': '5 V', external: 'External', '3v3': '3.3 V', '1v8': '1.8 V' }

/** The supply a stored or reported value names: a supply string, or the legacy eFuse number or `internal`. */
export function supplyOf(v: unknown): Supply | null {
  if (isSupply(v)) return v
  if (v === 1 || v === 'internal') return '5v'
  if (v === 2) return 'external'
  return null
}

/** The legacy `efuse` number of a supply (1 = 5 V, 2 = external); undefined for the switched ones. */
export const legacyEfuse = (s: unknown): 1 | 2 | undefined => (s === '5v' ? 1 : s === 'external' ? 2 : undefined)

/** The power tools' arguments for a supply. Every released MCP takes `efuse` 1/2 for 5 V and external,
 *  so those go as `efuse`; only the switched 3.3 V and 1.8 V need `supply` (MCP 4.0.7+). Send `supply`
 *  for all four once 4.0.7 is the oldest MCP the web app and the desktop app run. */
export const supplyToolArgs = (s: Supply): Record<string, unknown> =>
  s === '5v' ? { efuse: 1 } : s === 'external' ? { efuse: 2 } : { supply: s }

/** The profile's supply as a sentence fragment: "5 V", "external supply", "3.3 V", "not set". Accepts the legacy efuse number too. */
export function supplyLabel(supply: unknown): string {
  const s = supplyOf(supply)
  if (s === 'external') return 'external supply'
  return s ? SUPPLY_LABELS[s] : 'not set'
}

export type Wiring = {
  version: number
  /** LA I/O-bank voltage in mV (1800 or 3300). Must be set on the pod before any LA op. */
  la_mv: number
  /** The DUT power output: '5v', 'external', or on a BenchPod v4 '3v3' / '1v8'. '' = not set. The legacy profile key `efuse` (1/2) is read as 5v/external. */
  supply: Supply | ''
  /** LA channel the pod samples (wire the DUT's TX here); null = not wired. */
  uart_rx: number | null
  /** LA channel the pod drives (the DUT's RX); null = not wired. */
  uart_tx: number | null
  uart_baud: number
  /** The UART frame after the 8 data bits: parity, then stop bits. 8N1 by default (firmware 3.10.8+ for others). */
  uart_parity: UartParity
  uart_stop_bits: 1 | 2
  i2c_sda: number | null
  i2c_scl: number | null
  i2c_addr: string
  swd_swclk: number | null
  swd_swdio: number | null
  /** true = the DUT's reset is wired to the pod's reset pin (J1 pin 22, rev3 pods). */
  swd_nreset: boolean
  /** OpenOCD target config, e.g. `target/stm32f4x.cfg`. */
  swd_target: string
  /**
   * The JTAG pins (firmware with the jtag feature, gateware 61 or later). TCK may share a channel
   * with swd_swclk and TMS with swd_swdio; TRST (nTRST) is optional. Host tools use JTAG when all
   * of TCK, TMS, TDI and TDO are wired and there are no SWD pins or the target is JTAG-only.
   */
  jtag_tck: number | null
  jtag_tms: number | null
  jtag_tdi: number | null
  jtag_tdo: number | null
  jtag_trst: number | null
  /**
   * Which debug port the host tools use when both the SWD and the JTAG pins are wired: "swd",
   * "jtag" or null (automatic: JTAG when there are no SWD pins or the target only has JTAG).
   * Pins given in a call win over this.
   */
  debug_port: DebugPort | null
  spi_sclk: number | null
  spi_mosi: number | null
  spi_miso: number | null
  spi_cs: number | null
  signals: WiringSignal[]
  /**
   * The DUT direction of a role or signal where its default is wrong: role key or signal name ->
   * direction. Every wired role and signal has a default (ROLE_DUT_DIRS, SIGNAL_DUT_DIRS); the
   * hosts send the result to the pod with `la_dir` when the wiring is applied.
   */
  dut_dirs: Record<string, WiringDutDir>
  /**
   * The pull resistors powering the board on switches on (the others off): a list of LA channels,
   * each pulling its own direction (LA1-LA6 up, LA7/LA8 down on today's boards, see LA_PULLS), or a
   * map of channel -> "up" / "down". pullDirections() reads either; setPinPull writes the list
   * whenever every pull is its channel's own direction, so older readers keep working. null = the
   * profile leaves the pull resistors as they are (profiles saved before this key).
   */
  pulls: WiringPulls | null
  /**
   * External INA current monitors the SDK attaches on connect (at most 8). Left out of the stored
   * profile when empty (the editor patches it with `undefined`).
   */
  monitors: WiringMonitor[]
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
  'jtag_tck',
  'jtag_tms',
  'jtag_tdi',
  'jtag_tdo',
  'jtag_trst',
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
  jtag_tck: 'TCK',
  jtag_tms: 'TMS',
  jtag_tdi: 'TDI',
  jtag_tdo: 'TDO',
  jtag_trst: 'nTRST',
  spi_sclk: 'SPI SCLK',
  spi_mosi: 'SPI MOSI',
  spi_miso: 'SPI MISO',
  spi_cs: 'SPI CS',
}

export const LA_CHANNEL_COUNT = 14
export const MAX_WIRING_SIGNALS = 14

/** A pull direction a host asks for; the pod picks the resistor. */
export type PullDir = 'up' | 'down'

/** A profile's pulls as stored: channels pulling their own direction, or channel -> direction. */
export type WiringPulls = number[] | Record<string, PullDir>

/**
 * The pull resistor on one LA channel: the directions it can pull (`dirs`), the one a plain "on"
 * engages (`dir`) and its value. 3V3-referenced: unavailable while the bank is at 1.8 V. The pod
 * reports the same per channel (la_pins `pull_dirs`), which wins when it is connected.
 */
export type LaPull = { la: number; dir: PullDir | null; dirs: PullDir[]; ohms: string | null }

/**
 * Today's boards (every v3 board; the firmware's la_pins.c has the same table): LA1-LA6 pull up,
 * LA7/LA8 pull down, LA9-LA14 have none. A board revision with other resistors gets its own table.
 */
const PULL_TABLE_V3: Record<number, { dirs: PullDir[]; ohms: string }> = {
  1: { dirs: ['up'], ohms: '4.7k' },
  2: { dirs: ['up'], ohms: '4.7k' },
  3: { dirs: ['up'], ohms: '2.2k' },
  4: { dirs: ['up'], ohms: '2.2k' },
  5: { dirs: ['up'], ohms: '10k' },
  6: { dirs: ['up'], ohms: '10k' },
  7: { dirs: ['down'], ohms: '10k' },
  8: { dirs: ['down'], ohms: '10k' },
}

export const LA_PULLS: LaPull[] = Array.from({ length: LA_CHANNEL_COUNT }, (_, i) => {
  const la = i + 1
  const hw = PULL_TABLE_V3[la]
  return hw ? { la, dir: hw.dirs[0], dirs: hw.dirs, ohms: hw.ohms } : { la, dir: null, dirs: [], ohms: null }
})

/** "pull-up 4.7k", "pull-down 10k", "pull-up/down 10k" or "none": the resistor on one LA channel. */
export function pullLabel(p: LaPull): string {
  if (!p.dirs.length) return 'none'
  return `pull-${p.dirs.join('/')} ${p.ohms ?? ''}`.trim()
}

export const WIRING_DEFAULTS: Wiring = {
  version: 1,
  la_mv: 3300,
  supply: '5v',
  uart_rx: 5,
  uart_tx: 4,
  uart_baud: 115200,
  uart_parity: 'none',
  uart_stop_bits: 1,
  i2c_sda: 1,
  i2c_scl: 2,
  i2c_addr: '0x76',
  swd_swclk: 11,
  swd_swdio: 12,
  swd_nreset: false,
  swd_target: '',
  jtag_tck: null,
  jtag_tms: null,
  jtag_tdi: null,
  jtag_tdo: null,
  jtag_trst: null,
  debug_port: null,
  spi_sclk: null,
  spi_mosi: null,
  spi_miso: null,
  spi_cs: null,
  signals: [],
  dut_dirs: {},
  pulls: null,
  monitors: [],
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

/** The base of a version 2 profile (stored on the pod): nothing wired, no I/O voltage (la_mv 0), no
 *  power supply (supply ''), no I2C address (''). Only plain call settings keep a value (the UART baud,
 *  the SWD reset, and the control loop's input scale the Generator tab divides by). */
export const WIRING_UNDEFINED: Wiring = {
  ...WIRING_DEFAULTS,
  version: 2,
  la_mv: 0,
  supply: '',
  uart_rx: null,
  uart_tx: null,
  i2c_sda: null,
  i2c_scl: null,
  i2c_addr: '',
  swd_swclk: null,
  swd_swdio: null,
  loop_output_cal: [],
}

/** The wiring profile version new profiles are saved as. */
export const WIRING_VERSION = 2

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
// `efuse` is the legacy spelling of `supply` (1 = 5v, 2 = external): read, never kept on the Wiring.
const KNOWN_KEYS = new Set<string>([...Object.keys(DEFAULTS), 'efuse'])
const SIGNAL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
const MONITOR_NAME_RE = /^[A-Za-z][A-Za-z0-9_.@-]{0,31}$/

function isCalPoint(v: unknown): v is StageCalPoint {
  return (
    isRecord(v) &&
    typeof v.dac_v === 'number' && Number.isFinite(v.dac_v) &&
    typeof v.out_v === 'number' && Number.isFinite(v.out_v)
  )
}

export function isLaChannel(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LA_CHANNEL_COUNT
}

/** The LA channels that have a pull resistor (LA1-LA8). */
export const PULL_CHANNELS: number[] = LA_PULLS.filter((p) => p.dir).map((p) => p.la)

function hasPullResistor(v: unknown): v is number {
  return isLaChannel(v) && PULL_CHANNELS.includes(v)
}

/** A pulls list sorted, without duplicates. */
export function normalizePulls(las: number[]): number[] {
  return [...new Set(las)].sort((a, b) => a - b)
}

function isPullDir(v: unknown): v is PullDir {
  return v === 'up' || v === 'down'
}

/** Can LA `la`'s resistor pull `dir` (today's table)? */
export function pullSupports(la: number, dir: PullDir): boolean {
  return !!LA_PULLS[la - 1]?.dirs.includes(dir)
}

/** The profile's pulls as channel -> direction, from either stored form ({} for null). */
export function pullDirections(pulls: WiringPulls | null | undefined): Map<number, PullDir> {
  const out = new Map<number, PullDir>()
  if (Array.isArray(pulls)) {
    for (const la of normalizePulls(pulls)) {
      const d = LA_PULLS[la - 1]?.dir
      if (d) out.set(la, d)
    }
  } else if (pulls) {
    for (const [k, v] of Object.entries(pulls)) {
      const la = Number(k)
      if (hasPullResistor(la) && isPullDir(v)) out.set(la, v)
    }
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]))
}

/**
 * The stored form of channel -> direction: the list of channels when every pull is its channel's
 * own direction (what every reader, old and new, takes), else the map.
 */
export function canonicalPulls(dirs: Map<number, PullDir>): WiringPulls {
  const sorted = [...dirs].sort((a, b) => a[0] - b[0])
  if (sorted.every(([la, d]) => LA_PULLS[la - 1]?.dir === d)) return sorted.map(([la]) => la)
  return Object.fromEntries(sorted.map(([la, d]) => [String(la), d]))
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
    if (k === 'efuse') {
      // Legacy key: only when the profile has no `supply`.
      const legacy = v === 1 ? '5v' : v === 2 ? 'external' : null
      if (legacy && !isSupply(remote.supply)) out.supply = legacy
      continue
    }
    if (k === 'supply') {
      if (isSupply(v)) out.supply = v
      continue
    }
    if (PIN_KEYS.has(k)) {
      if (v === null || isLaChannel(v)) out[k] = v
      continue
    }
    const d = (DEFAULTS as Record<string, unknown>)[k]
    if (k === 'signals') {
      if (Array.isArray(v)) out.signals = v.filter(isRecord).map(coerceSignal)
    } else if (k === 'monitors') {
      if (Array.isArray(v)) out.monitors = v.filter(isRecord).map(coerceMonitor)
    } else if (k === 'dut_dirs') {
      if (isRecord(v)) out.dut_dirs = Object.fromEntries(Object.entries(v).filter(([, d]) => isDutDir(d)))
    } else if (k === 'pulls') {
      if (v === null) out.pulls = null
      else if (Array.isArray(v)) out.pulls = normalizePulls(v.filter(hasPullResistor))
      else if (isRecord(v))
        out.pulls = canonicalPulls(
          pullDirections(Object.fromEntries(Object.entries(v).filter(([k, d]) => isPullDir(d) && pullSupports(Number(k), d))) as Record<string, PullDir>),
        )
    } else if (k === 'uart_parity') {
      if (v === 'none' || v === 'even' || v === 'odd') out[k] = v
    } else if (k === 'debug_port') {
      if (v === null || v === 'swd' || v === 'jtag') out[k] = v
    } else if (k === 'uart_stop_bits') {
      if (v === 1 || v === 2) out[k] = v
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

function isDutDir(v: unknown): v is WiringDutDir {
  return WIRING_DUT_DIRS.includes(v as WiringDutDir)
}

/** The default DUT direction of each role: uart_rx is the pod's receive line, so the board drives it. */
export const ROLE_DUT_DIRS: Record<WiringRole, WiringDutDir> = {
  uart_rx: 'dut_output',
  uart_tx: 'dut_input',
  i2c_sda: 'bidir',
  i2c_scl: 'bidir',
  swd_swclk: 'dut_input',
  swd_swdio: 'bidir',
  jtag_tck: 'dut_input',
  jtag_tms: 'dut_input',
  jtag_tdi: 'dut_input',
  jtag_tdo: 'dut_output',
  jtag_trst: 'dut_input',
  spi_sclk: 'dut_input',
  spi_mosi: 'dut_input',
  spi_miso: 'dut_output',
  spi_cs: 'dut_input',
}

/** The default DUT direction of a signal from its (pod-side) direction: one the pod watches is a board output. */
export const SIGNAL_DUT_DIRS: Record<WiringDirection, WiringDutDir> = {
  input: 'dut_output',
  output: 'dut_input',
  open_drain: 'bidir',
  bidir: 'bidir',
}

/** The profile's explicit direction for a role or signal name (case-insensitive), or undefined. */
export function dutDirOverride(w: Pick<Wiring, 'dut_dirs'>, name: string): WiringDutDir | undefined {
  const key = Object.keys(w.dut_dirs ?? {}).find((k) => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : w.dut_dirs[key]
}

/** The default direction of a role or signal, ignoring dut_dirs. */
export function defaultDutDir(w: Wiring, name: string): WiringDutDir {
  if ((WIRING_ROLES as readonly string[]).includes(name)) return ROLE_DUT_DIRS[name as WiringRole]
  const sig = w.signals.find((s) => s.name.toLowerCase() === name.toLowerCase())
  return sig ? SIGNAL_DUT_DIRS[sig.direction] ?? 'dut_output' : 'dut_output'
}

/** The DUT direction of a role or signal: its dut_dirs entry, else its default. */
export function wiringDutDir(w: Wiring, name: string): WiringDutDir {
  return dutDirOverride(w, name) ?? defaultDutDir(w, name)
}

/** LA channel -> the DUT direction of what is wired to it, as the pod gets it with `la_dir`. */
export function pinDutDirs(w: Wiring): Record<number, WiringDutDir> {
  const out: Record<number, WiringDutDir> = {}
  for (const u of channelUsers(w)) {
    const d = wiringDutDir(w, u.kind === 'role' ? u.field : u.id)
    // SWDIO and TMS on one channel: driven and read, so both ways.
    out[u.la] = out[u.la] !== undefined && out[u.la] !== d ? 'bidir' : d
  }
  return out
}

/** dut_dirs with one entry set (or removed with `undefined`), keyed as given. */
export function withDutDir(w: Pick<Wiring, 'dut_dirs'>, name: string, dir: WiringDutDir | undefined): Record<string, WiringDutDir> {
  const out = Object.fromEntries(Object.entries(w.dut_dirs ?? {}).filter(([k]) => k.toLowerCase() !== name.toLowerCase()))
  if (dir) out[name] = dir
  return out
}

/** The default name of a monitor: `ina226@0x40` (the ina3221 adds `.1`). */
export function monitorDefaultName(m: Pick<WiringMonitor, 'chip' | 'addr' | 'channel'>): string {
  const base = `${m.chip}@0x${(Number.isFinite(m.addr) ? m.addr : 0).toString(16).padStart(2, '0')}`
  return m.chip === 'ina3221' ? `${base}.${m.channel ?? 1}` : base
}

/** A stored monitor entry kept as written (wrong values stay so validation can flag them); not a record's keys it does not know. */
function coerceMonitor(m: Record<string, unknown>): WiringMonitor {
  const out: Record<string, unknown> = {
    chip: (MONITOR_CHIPS as readonly string[]).includes(m.chip as string) ? m.chip : 'ina226',
    addr: typeof m.addr === 'number' ? m.addr : 0,
  }
  for (const k of ['shunt_ohm', 'channel', 'sda', 'scl', 'averaging', 'conversion_time', 'max_current'] as const) {
    if (typeof m[k] === 'number') out[k] = m[k]
  }
  if (typeof m.name === 'string') out.name = m.name
  return out as WiringMonitor
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
  const base = stored.version === 2 ? WIRING_UNDEFINED : DEFAULTS
  return { ...base, ...coerceStoredWiring(stored), version: stored.version === 2 ? 2 : base.version }
}

export type WiringIssues = { errors: WiringFieldIssue[]; warnings: WiringFieldIssue[] }

/** Role pairs that may sit on one LA channel: an Arm part's SWD and JTAG share SWCLK/TCK and SWDIO/TMS. */
export const SHARED_PIN_ROLES: readonly (readonly [WiringRole, WiringRole])[] = [
  ['swd_swclk', 'jtag_tck'],
  ['swd_swdio', 'jtag_tms'],
]

/** Whether two channel users may share a channel (SWD/JTAG pairs). */
export function sharesPin(a: string, b: string): boolean {
  return SHARED_PIN_ROLES.some(([x, y]) => (a === x && b === y) || (a === y && b === x))
}

/** Whether every user of a channel is one of the shared pair, so the channel is not in conflict. */
function isConflict(here: { id: string }[]): boolean {
  for (let i = 0; i < here.length; i += 1)
    for (let j = i + 1; j < here.length; j += 1) if (!sharesPin(here[i].id, here[j].id)) return true
  return false
}

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
  // null: the profile doesn't set the pulls, so a pull-down may be on.
  const dirs = pullDirections(w.pulls)
  const pullsDown = (la: number) => (w.pulls === null ? pullSupports(la, 'down') : dirs.get(la) === 'down')
  for (const role of ['i2c_sda', 'i2c_scl'] as const) {
    const la = w[role]
    if (!isLaChannel(la)) continue
    // The texts match the server's (wiring_profile.go wiringWarnings).
    if (!LA_PULLS[la - 1]?.dirs.length) out.push({ field: role, message: 'no pod pull-up on LA9-LA14; the bus needs external pull-ups' })
    else if (pullsDown(la))
      out.push({ field: role, message: 'LA7/LA8 have 10k pull-downs; keep them disabled on an open-drain bus' })
  }
  if (isLaChannel(w.uart_rx) && pullsDown(w.uart_rx)) {
    out.push({ field: 'uart_rx', message: 'LA7/LA8 have pull-downs; the UART idles high — keep the pull disabled' })
  }
  if (w.la_mv === 1800 && dirs.size)
    out.push({ field: 'pulls', message: 'at 1.8 V the pull resistors need firmware newer than 3.10.12; older firmware leaves them off' })
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
  if (has('version') && raw.version !== 1 && raw.version !== 2) err('version', 'version must be 1 or 2')
  if (has('la_mv') && raw.la_mv !== 1800 && raw.la_mv !== 3300)
    err('la_mv', 'la_mv must be 1800 or 3300 (the LA bank voltage in mV)')
  if (has('supply') && !isSupply(raw.supply))
    err('supply', "the supply must be '5v', 'external' or, on a BenchPod v4, '3v3' or '1v8'")
  if (has('efuse') && raw.efuse !== 1 && raw.efuse !== 2) err('efuse', "efuse is the old name of supply: 1 (5v) or 2 (external); use supply instead")
  else if (has('efuse') && has('supply') && isSupply(raw.supply) && legacyEfuse(raw.supply) !== raw.efuse)
    err('supply', 'supply and the old efuse key disagree; remove efuse')
  for (const role of WIRING_ROLES) {
    if (has(role) && raw[role] !== null && !isLaChannel(raw[role]))
      err(role, `${role} must be an LA channel 1-${LA_CHANNEL_COUNT}, or null when it isn't wired`)
  }
  if (has('uart_baud')) {
    const b = raw.uart_baud
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 300 || b > 4000000)
      err('uart_baud', 'uart_baud must be a whole number between 300 and 4000000')
  }
  if (has('uart_parity') && !['none', 'even', 'odd'].includes(raw.uart_parity as string))
    err('uart_parity', 'uart_parity must be "none", "even" or "odd"')
  if (has('uart_stop_bits') && raw.uart_stop_bits !== 1 && raw.uart_stop_bits !== 2) err('uart_stop_bits', 'uart_stop_bits must be 1 or 2')
  if (has('i2c_addr')) {
    const a = raw.i2c_addr
    const n = typeof a === 'string' && /^0x[0-9a-f]{1,2}$/i.test(a.trim()) ? Number.parseInt(a.trim().slice(2), 16) : NaN
    if (!(n >= 0x03 && n <= 0x77)) err('i2c_addr', 'i2c_addr must be a 7-bit hex address from 0x03 to 0x77, e.g. "0x76"')
  }
  if (has('debug_port') && raw.debug_port !== null && raw.debug_port !== 'swd' && raw.debug_port !== 'jtag')
    err('debug_port', 'debug_port must be "swd", "jtag" or null (automatic)')
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

  if (has('pulls') && raw.pulls !== null) {
    const pulls = raw.pulls as unknown
    if (Array.isArray(pulls))
      pulls.forEach((la, i) => {
        if (!hasPullResistor(la)) err(`pulls[${i}]`, `pulls[${i}] must be an LA channel with a pull resistor (LA1-LA8), got ${JSON.stringify(la)}`)
      })
    else if (isRecord(pulls))
      Object.entries(pulls).forEach(([k, d]) => {
        const la = Number(k)
        if (!hasPullResistor(la)) err(`pulls.${k}`, `pulls.${k} must be an LA channel with a pull resistor (LA1-LA8)`)
        else if (!isPullDir(d)) err(`pulls.${k}`, `pulls.${k} must be "up" or "down", got ${JSON.stringify(d)}`)
        else if (!pullSupports(la, d)) err(`pulls.${k}`, `LA${la} supports pull-${LA_PULLS[la - 1].dir} only on this board`)
      })
    else err('pulls', 'pulls must be a list of LA channels (e.g. [1, 2]) or a map of channel to "up" or "down"')
  }

  if (has('dut_dirs')) {
    const dirs = raw.dut_dirs
    if (!isRecord(dirs)) {
      err('dut_dirs', 'dut_dirs must be an object of role or signal name -> direction')
    } else {
      const names = new Set(
        (Array.isArray(raw.signals) ? raw.signals : []).filter(isRecord).map((s) => (typeof s.name === 'string' ? s.name.toLowerCase() : '')),
      )
      for (const [k, d] of Object.entries(dirs)) {
        if (!(WIRING_ROLES as readonly string[]).includes(k) && !names.has(k.toLowerCase()))
          err(`dut_dirs.${k}`, `dut_dirs.${k}: "${k}" is not a wiring role or a signal name`)
        else if (!isDutDir(d)) err(`dut_dirs.${k}`, `dut_dirs.${k} must be one of dut_input, dut_output, bidir`)
      }
    }
  }

  if (has('monitors')) validateMonitors(raw.monitors, effectiveWiring(raw), err)

  // Channel conflicts on the effective profile. Fields that already failed type/range checks are left
  // out, so a bad value doesn't also report a phantom conflict with the default it fell back to.
  const eff = effectiveWiring(raw)
  const bad = new Set(errors.map((e) => e.field))
  const byChannel = new Map<number, ChannelUser>()
  for (const u of channelUsers(eff, bad)) {
    const first = byChannel.get(u.la)
    if (first && !sharesPin(first.id, u.id)) err(u.field, `LA${u.la} is used by both ${first.id} and ${u.id}`)
    else if (!first) byChannel.set(u.la, u)
  }

  return { errors, warnings: pullWarnings(eff) }
}

function validateMonitors(list: unknown, eff: Wiring, err: (field: string, message: string) => void): void {
  if (!Array.isArray(list)) {
    err('monitors', 'monitors must be a list of monitor objects like {"chip": "ina226", "addr": 64, "shunt_ohm": 10}')
    return
  }
  if (list.length > MAX_WIRING_MONITORS) {
    err('monitors', `monitors has ${list.length} entries; at most ${MAX_WIRING_MONITORS}`)
    return
  }
  const names = new Map<string, number>()
  const addrs = new Map<string, number>()
  const pins: { name: string; sda: number; scl: number }[] = []
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  list.forEach((raw, i) => {
    const p = `monitors[${i}]`
    if (!isRecord(raw)) {
      err(p, `${p} must be an object like {"chip": "ina226", "addr": 64, "shunt_ohm": 10}`)
      return
    }
    let ok = true
    const bad = (field: string, message: string) => {
      ok = false
      err(field, message)
    }
    const chip = (MONITOR_CHIPS as readonly string[]).includes(raw.chip as string) ? (raw.chip as MonitorChip) : null
    if (raw.chip === undefined) bad(`${p}.chip`, `${p}.chip is required: one of ${MONITOR_CHIPS.join(', ')}`)
    else if (!chip) bad(`${p}.chip`, `${p}.chip must be one of ${MONITOR_CHIPS.join(', ')}`)
    const maxAddr = chip === 'ina3221' ? 0x43 : 0x4f
    if (raw.addr === undefined) bad(`${p}.addr`, `${p}.addr is required: the 7-bit I2C address, 0x40-0x4f`)
    else if (!(typeof raw.addr === 'number' && Number.isInteger(raw.addr) && raw.addr >= 0x40 && raw.addr <= maxAddr))
      bad(`${p}.addr`, `${p}.addr must be a whole number 64-${maxAddr} (0x40-0x${maxAddr.toString(16)})${chip === 'ina3221' ? ' for the ina3221' : ''}`)
    if (chip === 'ina260') {
      if (raw.shunt_ohm !== undefined && !(isNum(raw.shunt_ohm) && Math.abs(raw.shunt_ohm - INA260_SHUNT_OHM) < 1e-9))
        bad(`${p}.shunt_ohm`, `${p}.shunt_ohm: the ina260 has a fixed 0.002 ohm shunt; leave it out or give 0.002`)
    } else if (raw.shunt_ohm === undefined) {
      if (chip) bad(`${p}.shunt_ohm`, `${p}.shunt_ohm is required: the shunt resistor in ohms (e.g. 10)`)
    } else if (!(isNum(raw.shunt_ohm) && raw.shunt_ohm > 0 && raw.shunt_ohm <= 1e6)) {
      bad(`${p}.shunt_ohm`, `${p}.shunt_ohm must be a number above 0 and at most 1000000 (ohms)`)
    }
    let channel = 0
    if (raw.channel !== undefined) {
      if (chip && chip !== 'ina3221') bad(`${p}.channel`, `${p}.channel is only for the ina3221; remove it for the ${chip}`)
      else if (raw.channel !== 1 && raw.channel !== 2 && raw.channel !== 3) bad(`${p}.channel`, `${p}.channel must be 1, 2 or 3`)
      else channel = raw.channel
    } else if (chip === 'ina3221') channel = 1
    if (raw.name !== undefined) {
      if (typeof raw.name !== 'string' || !MONITOR_NAME_RE.test(raw.name))
        bad(`${p}.name`, `${p}.name must start with a letter and use only letters, digits and _ . @ - (at most 32 characters)`)
    }
    const pin = (key: 'sda' | 'scl', profilePin: number | null): number => {
      const v = raw[key]
      if (v === undefined) {
        if (profilePin === null) bad(`${p}.${key}`, `${p}.${key} is required here: the profile has no i2c_${key} to default to; give an LA channel 1-${LA_CHANNEL_COUNT}`)
        return profilePin ?? 0
      }
      if (!isLaChannel(v)) {
        bad(`${p}.${key}`, `${p}.${key} must be an LA channel 1-${LA_CHANNEL_COUNT}`)
        return 0
      }
      return v
    }
    const sda = pin('sda', eff.i2c_sda)
    const scl = pin('scl', eff.i2c_scl)
    if (sda && sda === scl) bad(`${p}.scl`, `${p}.sda and scl are both LA${sda}; they must be different channels`)
    if (raw.averaging !== undefined) {
      const allowed = MONITOR_AVERAGING[chip ?? 'ina226']
      if (!(typeof raw.averaging === 'number' && allowed.includes(raw.averaging)))
        bad(`${p}.averaging`, `${p}.averaging must be one of ${allowed.join(', ')}${chip ? ` for the ${chip}` : ''}`)
    }
    if (raw.conversion_time !== undefined && !(isNum(raw.conversion_time) && raw.conversion_time > 0 && raw.conversion_time <= 0.01))
      bad(`${p}.conversion_time`, `${p}.conversion_time must be a number of seconds above 0 and at most 0.01`)
    if (raw.max_current !== undefined && !(isNum(raw.max_current) && raw.max_current > 0))
      bad(`${p}.max_current`, `${p}.max_current must be a number of amps above 0`)
    const known = ['chip', 'addr', 'shunt_ohm', 'name', 'channel', 'sda', 'scl', 'averaging', 'conversion_time', 'max_current']
    for (const k of Object.keys(raw).sort())
      if (!known.includes(k) && raw[k] !== undefined)
        bad(`${p}.${k}`, `${p}.${k} is not a monitor field; monitors take ${known.slice(0, -1).join(', ')} and ${known[known.length - 1]}`)
    if (!ok || !chip) return
    const key = `${raw.addr}/${channel}`
    const dupAddr = addrs.get(key)
    if (dupAddr !== undefined)
      bad(`${p}.addr`, chip === 'ina3221'
        ? `${p}: address 0x${(raw.addr as number).toString(16)} channel ${channel} is already used by monitors[${dupAddr}]; each (addr, channel) can be used once`
        : `${p}.addr 0x${(raw.addr as number).toString(16)} is already used by monitors[${dupAddr}]; each address can be used once`)
    const name = typeof raw.name === 'string' ? raw.name : monitorDefaultName({ chip, addr: raw.addr as number, channel })
    const dupName = names.get(name.toLowerCase())
    if (dupName !== undefined) bad(`${p}.name`, `${p}.name "${name}" is already used by monitors[${dupName}]; monitor names must be unique (ignoring case)`)
    if (!ok) return
    addrs.set(key, i)
    names.set(name.toLowerCase(), i)
    pins.push({ name, sda, scl })
  })
  const first = pins[0]
  const other = first && pins.find((x) => x.sda !== first.sda || x.scl !== first.scl)
  if (first && other)
    err('monitors', `all monitors must share one pair of I2C pins (the pod has one I2C master): "${first.name}" is on LA${first.sda}/LA${first.scl} but "${other.name}" is on LA${other.sda}/LA${other.scl}`)
}

export type LaChannelUser = { kind: 'role' | 'signal'; id: string; label: string; field: string }
export type LaChannelInfo = {
  la: number
  pull: LaPull
  users: LaChannelUser[]
  /** More than one role/signal on this channel — the profile can't be saved like this. */
  conflict: boolean
  warnings: string[]
  /** The DUT direction of what is wired here (null when nothing is). */
  dutDir: WiringDutDir | null
}

/** Per-LA-channel view of a profile: who uses each of LA1..LA14, its pull resistor, conflicts/warnings. */
export function laChannelMap(w: Wiring): LaChannelInfo[] {
  const users = channelUsers(w)
  const warnings = pullWarnings(w)
  const dirs = pinDutDirs(w)
  return LA_PULLS.map((pull) => {
    const here = users.filter((u) => u.la === pull.la)
    const fields = new Set(here.map((u) => u.field))
    return {
      la: pull.la,
      pull,
      users: here.map(({ kind, id, label, field }) => ({ kind, id, label, field })),
      conflict: isConflict(here),
      warnings: warnings.filter((x) => fields.has(x.field)).map((x) => x.message),
      dutDir: dirs[pull.la] ?? null,
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

/** The pull resistor as a short label: "4.7k pull-up", "10k pull-down", "no pull". */
export function laPullLabel(p: LaPull): string {
  if (!p.dirs.length) return 'no pull'
  return `${p.ohms} pull-${p.dirs.join('/')}`
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
    if ((LOOP_INPUT_KEYS as readonly string[]).includes(k)) continue
    if (k === 'monitors' && !w.monitors.length) continue // not set: left out
    out[k] = v
  }
  // Pods on firmware without the `supply` key read `efuse`: write both for the two eFuse supplies.
  const efuse = legacyEfuse(w.supply)
  if (efuse) out.efuse = efuse
  return out
}

/** The first LA channel nothing in the profile uses (for a new signal), or null when all 14 are taken. */
export function firstFreeLaChannel(w: Wiring): number | null {
  const used = new Set(channelUsers(w).map((u) => u.la))
  for (let la = 1; la <= LA_CHANNEL_COUNT; la += 1) if (!used.has(la)) return la
  return null
}

