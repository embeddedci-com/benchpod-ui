// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { BoardView } from './BoardView'
import { boardHeaderFromStatus, boardSheet, boardSvg, detectBoardHeader, sheetRows } from './boardSheet'
import { effectiveWiring } from './model'

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
})
afterEach(cleanup)

const w = effectiveWiring({
  version: 2,
  la_mv: 3300,
  efuse: 1,
  uart_rx: 3,
  uart_tx: 4,
  uart_baud: 115200,
  swd_swclk: 11,
  swd_swdio: 12,
  swd_nreset: true,
  swd_target: 'target/stm32f4x.cfg',
  signals: [{ name: 'HEATER_EN', la: 9, direction: 'output', active_low: false, description: '' }],
  pulls: [3],
})

describe('boardSheet', () => {
  it('puts the profile on the header pins and lists what to connect', () => {
    const s = boardSheet(w, 'j1', 'process-node')
    expect(s.pins).toHaveLength(22)
    expect(s.summary).toBe('I/O 3.3 V, target power internal 5 V, UART 115200 8N1, SWD stm32f4x')
    const rows = sheetRows(s)
    expect(rows.map((r) => [r.pins, r.usedFor, r.connect, r.pull])).toEqual([
      ['3', 'UART RX', 'board TX', 'pull-up 2.2k'],
      ['4', 'UART TX', 'board RX', ''],
      ['9', 'HEATER_EN', 'HEATER_EN (the pod drives it)', ''],
      ['11', 'SWCLK', 'SWCLK', ''],
      ['12', 'SWDIO', 'SWDIO', ''],
      ['22', 'Reset', 'board NRST', ''],
      ['15, 16', 'Ground', 'board GND (any one)', ''],
    ])
  })

  it('has the extra ground pins on the front connector', () => {
    const s = boardSheet(w, 'front', 'x')
    expect(s.pins).toHaveLength(26)
    expect(sheetRows(s).at(-1)!.pins).toBe('15, 16, 23, 24, 25, 26')
  })

  it('escapes profile text in the SVG and uses no CSS variables', () => {
    const bad = effectiveWiring({ version: 2, signals: [{ name: '<b>&', la: 1, direction: 'input', active_low: false, description: '' }] })
    for (const h of ['j1', 'front'] as const) {
      const svg = boardSvg(boardSheet(bad, h, 'a<b'))
      expect(svg).toContain('&lt;b&gt;&amp;')
      expect(svg).not.toContain('<b>')
      expect(svg).not.toContain('var(')
      expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull()
    }
  })

  it('picks the header from the pod status', () => {
    expect(boardHeaderFromStatus({ board_rev: 'v3r2' })).toBe('j1')
    expect(boardHeaderFromStatus({ board_rev: 'v3', short_form: true })).toBeNull()
    expect(boardHeaderFromStatus({ data: { board_rev: 'v3', module: { present: true } } })).toBe('front')
    expect(boardHeaderFromStatus({})).toBeNull()
    expect(boardHeaderFromStatus(null)).toBeNull()
  })
})

describe('detectBoardHeader', () => {
  it('asks the module command first, then the status', async () => {
    expect(await detectBoardHeader(async () => ({ status: 'ok', data: { present: true } }))).toBe('front')
    expect(await detectBoardHeader(async () => ({ status: 'error', error: 'module: this BenchPod has no module link (digital v3r3 only)' }))).toBe('j1')
    const old = async (c: Record<string, unknown>) =>
      c.cmd === 'module' ? { status: 'error', error: 'unknown command' } : { status: 'ok', data: { board_rev: 'v3r2' } }
    expect(await detectBoardHeader(old)).toBe('j1')
    const unsure = async (c: Record<string, unknown>) =>
      c.cmd === 'module' ? { status: 'error', error: 'unknown command' } : { status: 'ok', data: { board_rev: 'v3', short_form: true } }
    expect(await detectBoardHeader(unsure)).toBeNull()
    expect(await detectBoardHeader(async () => { throw new Error('module: this BenchPod has no module link') })).toBe('j1')
  })
})

describe('BoardView', () => {
  it('shows the drawing and the table, and lets the user pick the header when the pod does not say', () => {
    render(
      <MantineProvider>
        <BoardView wiring={w} title="process-node" header={null} />
      </MantineProvider>,
    )
    expect(screen.getByTestId('board-view-svg').innerHTML).toContain('J1, looking down')
    expect(screen.getByText('HEATER_EN (the pod drives it)')).toBeTruthy()
    fireEvent.click(screen.getByText('Front connector (2x13, v3r3 and later)'))
    expect(screen.getByTestId('board-view-svg').innerHTML).toContain('Facing the front')
  })

  it('shows no header choice when the pod reports its board', () => {
    render(
      <MantineProvider>
        <BoardView wiring={w} title="p" header="front" />
      </MantineProvider>,
    )
    expect(screen.queryByText('Pin headers (2x11, up to v3-r2)')).toBeNull()
  })
})
