// The wiring profile drawn on the pod's real I/O header: which header pin carries what, as the
// user sees the connector. Read-only, made to look at, print or keep next to the bench.
//
// Two headers exist:
//   j1     the 2x11 J1 of the one-piece boards up to v3-r2, seen from above (pin 1 bottom right,
//          at the ADC/DAC end; even pins along the board edge on the left).
//   front  the 2x13 right-angle box header on the front of digital v3r3 and later, seen facing
//          the front of the enclosure (pin 1 top right, odd pins on top).
// Pin numbers and nets match J1 in pcb/benchpod at analog-v3r2 and pcb/benchpod-digital at
// digital-v3r3; the docs' pinout pages draw the same headers from the same table.
//
// Everything here is plain data and strings, so the web app, the desktop app, the print sheet and
// the SVG download all show the same drawing. Colors are fixed hex values (no CSS variables): the
// SVG must look the same outside the app, in a file or on paper.

import { LA_PULLS, supplyLabel, WIRING_ROLES, type Wiring, type WiringRole } from './model'
import { pinViews, roleKind, signalUse, type PinKind } from './pins'

export type BoardHeader = 'j1' | 'front'

export const BOARD_HEADER_LABELS: Record<BoardHeader, string> = {
  j1: 'Pin headers (2x11, up to v3-r2)',
  front: 'Front connector (2x13, v3r3 and later)',
}

export type HeaderPinKind = 'la' | 'gnd' | 'power' | 'can' | 'vccio' | 'reset'
export interface HeaderPin {
  n: number
  label: string
  kind: HeaderPinKind
}

const COMMON_PINS: HeaderPin[] = [
  ...Array.from({ length: 14 }, (_, i): HeaderPin => ({ n: i + 1, label: `LA${i + 1}`, kind: 'la' })),
  { n: 15, label: 'GND', kind: 'gnd' },
  { n: 16, label: 'GND', kind: 'gnd' },
  { n: 17, label: '+3V3', kind: 'power' },
  { n: 18, label: '+1V8', kind: 'power' },
  { n: 19, label: 'CAN+', kind: 'can' },
  { n: 20, label: 'CAN−', kind: 'can' },
  { n: 21, label: 'LA_REF', kind: 'vccio' },
  { n: 22, label: 'NRST_CONTROL', kind: 'reset' },
]

/** Every pin of each header, pin 1 first. */
export const HEADER_PINS: Record<BoardHeader, HeaderPin[]> = {
  j1: COMMON_PINS,
  front: [...COMMON_PINS, ...[23, 24, 25, 26].map((n): HeaderPin => ({ n, label: 'GND', kind: 'gnd' }))],
}

/**
 * The header a pod has, from its status. Digital v3r3 and later report `module` (the analog module
 * link) in the full status, which LAN and USB connections get. board_rev v2 and v3r2 are one-piece
 * boards (J1). Everything else is unsure: a short status (the cloud's) has no `module`, and "v3" is
 * both the older one-piece boards and digital v3r3. null then, and the user picks.
 */
export function boardHeaderFromStatus(status: Record<string, unknown> | null | undefined): BoardHeader | null {
  if (!status) return null
  const s = (status.data && typeof status.data === 'object' ? status.data : status) as Record<string, unknown>
  if (s.module !== undefined && s.module !== null) return 'front'
  if (s.board_rev === 'v2' || s.board_rev === 'v3r2') return 'j1'
  return null
}

/** A pod reply as the hosts get it: {status: 'ok', data} or {status: 'error', error}. */
export type PodReply = { status?: string; data?: unknown; error?: string; message?: string } | null | undefined

/**
 * The pod's header, asked the pod: the read-only `module` command answers on digital v3r3 and
 * later (front connector) and refuses with "no module link" on the one-piece boards (J1); it works
 * over the cloud too. Firmware without the command falls back to the status
 * (boardHeaderFromStatus). null when neither says: the user picks.
 */
export async function detectBoardHeader(run: (cmd: Record<string, unknown>) => Promise<PodReply>): Promise<BoardHeader | null> {
  try {
    const r = await run({ cmd: 'module' })
    if (r?.status === 'ok') return 'front'
    if (/no module link/i.test(`${r?.error ?? ''} ${r?.message ?? ''}`)) return 'j1'
  } catch (e) {
    if (/no module link/i.test(String((e as Error)?.message ?? e))) return 'j1'
  }
  try {
    const r = await run({ cmd: 'status' })
    return r?.status === 'ok' || r?.status === undefined ? boardHeaderFromStatus((r?.data ?? r) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Fixed colors (Mantine's 6 shades), the same hues as the Pins editor's tiles.
export const KIND_HEX: Record<PinKind, string> = {
  uart: '#228be6',
  i2c: '#12b886',
  swd: '#7950f2',
  jtag: '#5c7cfa',
  spi: '#fd7e14',
  signal: '#15aabf',
}
const KIND_NAMES: Record<PinKind, string> = { uart: 'UART', i2c: 'I2C', swd: 'SWD', jtag: 'JTAG', spi: 'SPI', signal: 'Signal' }
const FIXED_HEX: Record<Exclude<HeaderPinKind, 'la'>, string> = {
  gnd: '#495057',
  power: '#f59f00',
  can: '#be4bdb',
  vccio: '#868e96',
  reset: '#e64980',
}
const INK = '#212529'
const DIM = '#868e96'
const FREE_FILL = '#ffffff'
const FREE_STROKE = '#adb5bd'
const BODY_FILL = '#f1f3f5'
const BODY_STROKE = '#ced4da'

/** What goes on the DUT side of each role. */
const ROLE_CONNECT: Record<WiringRole, string> = {
  uart_rx: 'board TX',
  uart_tx: 'board RX',
  i2c_sda: 'SDA',
  i2c_scl: 'SCL',
  swd_swclk: 'SWCLK',
  swd_swdio: 'SWDIO',
  jtag_tck: 'TCK',
  jtag_tms: 'TMS',
  jtag_tdi: 'TDI',
  jtag_tdo: 'TDO',
  jtag_trst: 'nTRST',
  spi_sclk: 'SCLK',
  spi_mosi: 'MOSI (board SDI)',
  spi_miso: 'MISO (board SDO)',
  spi_cs: 'CS',
}
const SIGNAL_USE_TEXT = { reads: 'the pod reads it', drives: 'the pod drives it', both: 'open drain, both ways' }

/** One header pin as the sheet shows it. */
export interface SheetPin {
  n: number
  /** "LA3", "GND", "+3V3" ... */
  name: string
  kind: HeaderPinKind
  /** For LA pins: what the profile puts there, null when free. */
  use: { kind: PinKind; label: string; connect: string }[] | null
  /** "pull-up 4.7k" when the profile switches this pin's resistor on. */
  pull: string | null
  /** A fixed pin the profile uses (NRST_CONTROL with swd_nreset). */
  used: boolean
}

export interface BoardSheet {
  header: BoardHeader
  title: string
  /** "I/O 3.3 V, target power internal 5 V, UART 115200 8N1": what the profile sets besides pins. */
  summary: string
  pins: SheetPin[]
}

function fmtVolts(mv: number) {
  return `${(mv / 1000).toFixed(1)} V`
}

function summaryOf(w: Wiring, uartUsed: boolean, swdUsed: boolean, jtagUsed: boolean): string {
  const parts = [
    `I/O ${w.la_mv ? fmtVolts(w.la_mv) : 'not set'}`,
    `target power ${supplyLabel(w.supply)}`,
  ]
  if (uartUsed && w.uart_baud) {
    const parity = w.uart_parity === 'even' ? 'E' : w.uart_parity === 'odd' ? 'O' : 'N'
    parts.push(`UART ${w.uart_baud} 8${parity}${w.uart_stop_bits === 2 ? 2 : 1}`)
  }
  if ((swdUsed || jtagUsed) && w.swd_target) parts.push(`${swdUsed ? 'SWD' : 'JTAG'} ${w.swd_target.replace(/^target\//, '').replace(/\.cfg$/, '')}`)
  return parts.join(', ')
}

/** The sheet for a profile on a header. */
export function boardSheet(w: Wiring, header: BoardHeader, title: string): BoardSheet {
  const views = pinViews(w)
  const pins = HEADER_PINS[header].map((p): SheetPin => {
    if (p.kind !== 'la') {
      const used = p.kind === 'reset' && !!w.swd_nreset
      return { n: p.n, name: p.label, kind: p.kind, use: null, pull: null, used }
    }
    const v = views[p.n - 1]
    const use = v.users.length
      ? v.users.map((u) =>
          u.kind === 'role'
            ? { kind: roleKind(u.role), label: u.label, connect: ROLE_CONNECT[u.role] }
            : { kind: 'signal' as PinKind, label: u.label, connect: `${u.label} (${SIGNAL_USE_TEXT[signalUse(u.signal)]})` },
        )
      : null
    const pull = LA_PULLS[p.n - 1]
    return { n: p.n, name: p.label, kind: 'la', use, pull: v.pullOn && pull.dir ? `pull-${pull.dir} ${pull.ohms}` : null, used: !!use }
  })
  const roleOn = (prefix: string) => WIRING_ROLES.some((r) => r.startsWith(prefix) && w[r] != null)
  return { header, title, summary: summaryOf(w, roleOn('uart_'), roleOn('swd_'), roleOn('jtag_')), pins }
}

/** One row of the "what to connect" table: only what the profile uses, plus ground. */
export interface SheetRow {
  pins: string
  name: string
  usedFor: string
  connect: string
  pull: string
}

export function sheetRows(sheet: BoardSheet): SheetRow[] {
  const rows: SheetRow[] = []
  for (const p of sheet.pins) {
    if (p.kind === 'la' && p.use) {
      rows.push({
        pins: String(p.n),
        name: p.name,
        usedFor: p.use.map((u) => u.label).join(' / '),
        connect: p.use.map((u) => u.connect).join(' / '),
        pull: p.pull ?? '',
      })
    }
    if (p.kind === 'reset' && p.used) rows.push({ pins: String(p.n), name: p.name, usedFor: 'Reset', connect: 'board NRST', pull: '' })
  }
  const gnd = sheet.pins.filter((p) => p.kind === 'gnd').map((p) => p.n)
  rows.push({ pins: gnd.join(', '), name: 'GND', usedFor: 'Ground', connect: 'board GND (any one)', pull: '' })
  return rows
}

// ---- SVG ----

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Long signal names are cut so a label never runs off the drawing. */
function clip(s: string, max = 18): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function useText(p: SheetPin): string {
  if (p.use) return clip(p.use.map((u) => u.label).join(' / '))
  if (p.kind === 'reset') return p.used ? 'DUT reset' : ''
  return ''
}

function pinFill(p: SheetPin): { fill: string; stroke: string } {
  if (p.kind === 'la') return p.use ? { fill: KIND_HEX[p.use[0].kind], stroke: KIND_HEX[p.use[0].kind] } : { fill: FREE_FILL, stroke: FREE_STROKE }
  return { fill: FIXED_HEX[p.kind], stroke: FIXED_HEX[p.kind] }
}

const PAD = 16
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function pad(p: SheetPin, cx: number, cy: number): string {
  const { fill, stroke } = pinFill(p)
  const sq = p.n === 1
  const ring = sq ? `<rect x="${cx - PAD / 2 - 5}" y="${cy - PAD / 2 - 5}" width="${PAD + 10}" height="${PAD + 10}" fill="none" stroke="${INK}" stroke-width="1.2"/>` : ''
  return `${ring}<rect x="${cx - PAD / 2}" y="${cy - PAD / 2}" width="${PAD}" height="${PAD}" rx="${sq ? 0 : PAD / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
}

/** "LA3" dim + use bold (or the fixed pin's name), ordered so the pin name sits next to the pad. */
function label(p: SheetPin, nameFirst: boolean): string {
  const use = useText(p)
  const isLa = p.kind === 'la'
  const name = `<tspan fill="${isLa ? DIM : INK}" font-family="${MONO}">${esc(p.name)}</tspan>`
  if (!use) return name
  const u = `<tspan fill="${INK}" font-weight="700">${esc(use)}</tspan>`
  return nameFirst ? `${name}  ${u}` : `${u}  ${name}`
}

function pullMark(p: SheetPin, x: number, y: number, anchor: 'start' | 'end' | 'middle', rotate?: number): string {
  if (!p.pull) return ''
  const t = rotate !== undefined ? ` transform="rotate(${rotate} ${x} ${y})"` : ''
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="10.5" fill="${DIM}"${t}>${esc(p.pull)}</text>`
}

function legend(sheet: BoardSheet, x: number, y: number, width: number): { svg: string; height: number } {
  const kinds: PinKind[] = []
  for (const p of sheet.pins) for (const u of p.use ?? []) if (!kinds.includes(u.kind)) kinds.push(u.kind)
  const items: [string, string, boolean][] = [
    ...kinds.map((k): [string, string, boolean] => [KIND_HEX[k], KIND_NAMES[k], false]),
    [FIXED_HEX.gnd, 'GND', false],
    [FIXED_HEX.power, 'Power out', false],
    [FIXED_HEX.can, 'CAN', false],
    [FIXED_HEX.reset, 'Reset', false],
    [FREE_FILL, 'Not used', true],
  ]
  let cx = x
  let cy = y
  const out: string[] = []
  for (const [color, text, hollow] of items) {
    const w = 26 + text.length * 7.2 + 18
    if (cx + w > x + width) {
      cx = x
      cy += 22
    }
    out.push(
      `<circle cx="${cx + 7}" cy="${cy - 4}" r="7" fill="${color}" stroke="${hollow ? FREE_STROKE : color}" stroke-width="1.5"/>` +
        `<text x="${cx + 20}" y="${cy}" font-size="12" fill="${INK}">${esc(text)}</text>`,
    )
    cx += w
  }
  return { svg: out.join(''), height: cy - y + 22 }
}

function frame(width: number, height: number, sheet: BoardSheet, body: string, note: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" font-family="${SANS}">` +
    `<title>${esc(`${sheet.title}: wiring on the BenchPod header`)}</title>` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="24" y="32" font-size="18" font-weight="700" fill="${INK}">${esc(sheet.title)}</text>` +
    `<text x="24" y="54" font-size="12.5" fill="${DIM}">${esc(sheet.summary)}</text>` +
    `<text x="24" y="74" font-size="12.5" fill="${DIM}">${esc(note)}</text>` +
    body +
    `</svg>`
  )
}

// j1: 2x11, vertical, looking down at the pod. Rows from the top: pins 21/22 first, 1/2 last.
function svgJ1(sheet: BoardSheet): string {
  const W = 760
  const ROWS = 11
  const ROW_H = 36
  const TOP = 110
  const BODY_W = 112
  const BODY_X = W / 2 - BODY_W / 2
  const LCX = BODY_X + 30
  const RCX = BODY_X + BODY_W - 30
  const byN = new Map(sheet.pins.map((p) => [p.n, p]))
  const rowY = (row: number) => TOP + row * ROW_H + ROW_H / 2
  const parts: string[] = []
  const edgeX = 70
  parts.push(`<line x1="${edgeX}" y1="${TOP}" x2="${edgeX}" y2="${TOP + ROWS * ROW_H}" stroke="${BODY_STROKE}" stroke-width="2"/>`)
  parts.push(
    `<text x="${edgeX - 10}" y="${TOP + (ROWS * ROW_H) / 2}" transform="rotate(-90 ${edgeX - 10} ${TOP + (ROWS * ROW_H) / 2})" text-anchor="middle" font-size="11.5" fill="${DIM}">board edge</text>`,
  )
  parts.push(`<rect x="${BODY_X}" y="${TOP}" width="${BODY_W}" height="${ROWS * ROW_H}" rx="8" fill="${BODY_FILL}" stroke="${BODY_STROKE}" stroke-width="1.5"/>`)
  for (let row = 0; row < ROWS; row++) {
    const pair = ROWS - 1 - row
    const odd = byN.get(pair * 2 + 1)!
    const even = byN.get(pair * 2 + 2)!
    const y = rowY(row)
    // Even pins on the left, along the board edge: label reads into the pad.
    parts.push(`<text x="${LCX - PAD / 2 - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${DIM}">${even.n}</text>`)
    parts.push(pad(even, LCX, y))
    parts.push(`<text x="${BODY_X - 14}" y="${y + 5}" text-anchor="end" font-size="13" fill="${INK}">${label(even, false)}</text>`)
    parts.push(pullMark(even, BODY_X - 14, y + 18, 'end'))
    // Odd pins on the right, pin 1 at the bottom.
    parts.push(`<text x="${RCX + PAD / 2 + (odd.n === 1 ? 10 : 6)}" y="${y + 4}" font-size="10" fill="${DIM}" font-weight="${odd.n === 1 ? 700 : 400}">${odd.n}</text>`)
    parts.push(pad(odd, RCX, y))
    parts.push(`<text x="${BODY_X + BODY_W + 14}" y="${y + 5}" font-size="13" fill="${INK}">${label(odd, true)}</text>`)
    parts.push(pullMark(odd, BODY_X + BODY_W + 14, y + 18, 'start'))
  }
  const bottom = TOP + ROWS * ROW_H
  parts.push(`<text x="${W / 2}" y="${bottom + 24}" text-anchor="middle" font-size="12" fill="${DIM}">▼ ADC / DAC end of the pod</text>`)
  const lg = legend(sheet, 24, bottom + 60, W - 48)
  parts.push(lg.svg)
  return frame(W, bottom + 60 + lg.height + 8, sheet, parts.join(''), 'J1, looking down at the pod: pin 1 is the square pad at the bottom right')
}

// front: 2x13 right-angle header, facing the front. Pin 1 top right; odd pins on top.
function svgFront(sheet: BoardSheet): string {
  const W = 760
  const COLS = 13
  const COL_W = 52
  const X0 = (W - COLS * COL_W) / 2
  const LABEL_H = 190
  const BODY_TOP = 96 + LABEL_H
  const BODY_H = 96
  const UPPER_Y = BODY_TOP + 32
  const LOWER_Y = BODY_TOP + BODY_H - 32
  const byN = new Map(sheet.pins.map((p) => [p.n, p]))
  const colX = (col: number) => X0 + col * COL_W + COL_W / 2
  const parts: string[] = []
  parts.push(`<rect x="${X0}" y="${BODY_TOP}" width="${COLS * COL_W}" height="${BODY_H}" rx="8" fill="${BODY_FILL}" stroke="${BODY_STROKE}" stroke-width="1.5"/>`)
  for (let col = 0; col < COLS; col++) {
    const x = colX(col)
    const pairFromRight = COLS - 1 - col
    const up = byN.get(pairFromRight * 2 + 1)!
    const lo = byN.get(pairFromRight * 2 + 2)!
    // Upper row: label above, reading upwards, the pin name next to the pad.
    const ty = BODY_TOP - 12
    parts.push(`<text x="${x + 4}" y="${ty}" transform="rotate(-90 ${x + 4} ${ty})" font-size="12.5" fill="${INK}">${label(up, true)}</text>`)
    parts.push(pullMark(up, x + 17, ty, 'start', -90))
    parts.push(`<text x="${x}" y="${UPPER_Y - PAD / 2 - (up.n === 1 ? 10 : 6)}" text-anchor="middle" font-size="10" fill="${DIM}" font-weight="${up.n === 1 ? 700 : 400}">${up.n}</text>`)
    parts.push(pad(up, x, UPPER_Y))
    // Lower row: label below, reading upwards, ending next to the pad.
    parts.push(pad(lo, x, LOWER_Y))
    parts.push(`<text x="${x}" y="${LOWER_Y + PAD / 2 + 13}" text-anchor="middle" font-size="10" fill="${DIM}">${lo.n}</text>`)
    const by = BODY_TOP + BODY_H + 12
    parts.push(`<text x="${x + 4}" y="${by}" transform="rotate(-90 ${x + 4} ${by})" text-anchor="end" font-size="12.5" fill="${INK}">${label(lo, false)}</text>`)
    parts.push(pullMark(lo, x + 17, by, 'end', -90))
  }
  const bottom = BODY_TOP + BODY_H + 12 + LABEL_H
  const lg = legend(sheet, 24, bottom + 20, W - 48)
  parts.push(lg.svg)
  return frame(W, bottom + 20 + lg.height + 8, sheet, parts.join(''), 'Facing the front of the pod, looking into the I/O connector: pin 1 is the square pad at the top right')
}

/** The drawing as a standalone SVG document (also what the app shows). */
export function boardSvg(sheet: BoardSheet): string {
  return sheet.header === 'front' ? svgFront(sheet) : svgJ1(sheet)
}

/** A printable page: the drawing and the "what to connect" table, no app chrome. */
export function boardSheetHtml(sheet: BoardSheet): string {
  const rows = sheetRows(sheet)
    .map((r) => `<tr><td>${esc(r.pins)}</td><td>${esc(r.name)}</td><td>${esc(r.usedFor)}</td><td>${esc(r.connect)}</td><td>${esc(r.pull)}</td></tr>`)
    .join('')
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheet.title)}</title><style>` +
    `body{margin:24px;font-family:${SANS};color:${INK};background:#fff}` +
    `svg{max-width:100%;height:auto;display:block;margin:0 auto 16px}` +
    `table{border-collapse:collapse;width:100%;font-size:12px}` +
    `th,td{border:1px solid #dee2e6;padding:4px 8px;text-align:left}th{background:#f1f3f5}` +
    `@page{margin:12mm}@media print{body{margin:0}}` +
    `</style></head><body>${boardSvg(sheet)}` +
    `<table><thead><tr><th>Header pin</th><th>Name</th><th>Used for</th><th>Connect to</th><th>Pull resistor</th></tr></thead><tbody>${rows}</tbody></table>` +
    `</body></html>`
  )
}

