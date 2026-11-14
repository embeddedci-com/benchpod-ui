// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { BenchCall, BenchResult } from '../bench/benchCall'
import { BusDashboard } from './BusDashboard'
import { TransactionLog } from './TransactionLog'
import type { BusLogRow } from './busLog'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

const ok = (structured: unknown): BenchResult => ({ text: JSON.stringify(structured), structured })
const call: BenchCall = vi.fn(async (tool) => {
  if (tool === 'wiring') return ok({ pins: [{ la: 1, wired_to: 'i2c_sda' }, { la: 2, wired_to: 'i2c_scl' }] })
  if (tool === 'la_pins') return ok({ pins: [] })
  if (tool === 'sensor_library') return ok({ sensors: [] })
  return ok({})
})
const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>)

/** Every field a person fills in carries its name itself (aria-label), so a reader that does not
 * follow <label for> (some accessibility tools read the placeholder instead) still names it. */
function unnamedFields(root: HTMLElement): string[] {
  const out: string[] = []
  root.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=radio]), textarea, [role=radiogroup]').forEach((el) => {
    if (!el.getAttribute('aria-label')?.trim() && !el.getAttribute('aria-labelledby')) out.push(el.outerHTML.slice(0, 120))
  })
  return out
}

describe('bus console accessibility', () => {
  it('names every field in the I2C, SPI, CAN and GPIO tabs and in device mode', async () => {
    wrap(<BusDashboard call={call} fetchCapture={(async () => ({})) as never} />)
    await screen.findByRole('button', { name: 'Scan' })
    for (const tab of ['I2C', 'SPI', 'CAN', 'GPIO']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      const panel = screen.getByRole('tabpanel', { name: tab })
      expect(unnamedFields(panel), tab).toEqual([])
    }
    fireEvent.click(screen.getByRole('tab', { name: 'I2C' }))
    expect(screen.getByRole('textbox', { name: 'Address' }).getAttribute('aria-label')).toBe('Address')
    expect(screen.getByRole('textbox', { name: 'Write (hex)' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Pull-ups' })).toBeTruthy()
    // The pin pickers are named by their label, not their placeholder ("wiring").
    expect(screen.getByRole('combobox', { name: 'SDA' }).getAttribute('aria-label')).toBe('SDA')
    fireEvent.click(screen.getByRole('switch', { name: 'Device mode' }))
    expect(unnamedFields(screen.getByRole('tabpanel', { name: 'I2C' }))).toEqual([])
  })
})

const rows: BusLogRow[] = [
  { id: 1, time: 0, proto: 'I2C', tool: 'i2c_transfer', out: '0x48 w 0f 10 20 30 40 50 60 70 80 90 a0 b0, r 8', in: '1a 2b 3c 4d 5e 6f 70 81', status: 'ack' },
  { id: 2, time: 1, proto: 'SPI', tool: 'spi_transfer', out: '9f 00 00 00 (mode 0)', in: 'ef 40 18', status: 'ok', note: 'jedec' },
]

describe('the log when narrow', () => {
  it('stacks each call with Out and In on lines of their own', () => {
    wrap(<TransactionLog rows={rows} onClear={() => {}} layout="stacked" />)
    const log = screen.getByTestId('bus-log')
    expect(log.getAttribute('data-layout')).toBe('stacked')
    const items = within(log).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Out 9f 00 00 00 (mode 0)')
    expect(items[0].textContent).toContain('In ef 40 18')
    expect(items[1].textContent).toContain('ACK')
  })

  it('wraps bytes between bytes, never inside one, in both layouts', () => {
    for (const layout of ['stacked', 'table'] as const) {
      const { container, unmount } = wrap(<TransactionLog rows={rows} onClear={() => {}} layout={layout} />)
      const byteBoxes = [...container.ownerDocument.querySelectorAll<HTMLElement>('[style*="word-break"]')]
      expect(byteBoxes.some((el) => el.textContent?.includes('1a 2b 3c 4d 5e 6f 70 81')), layout).toBe(true)
      for (const el of byteBoxes) expect(el.style.wordBreak, layout).toBe('normal')
      expect(container.ownerDocument.querySelector('[style*="anywhere"]'), layout).toBeNull()
      unmount()
    }
  })

  it('is a table by default where there is room', () => {
    wrap(<TransactionLog rows={rows} onClear={() => {}} />)
    expect(within(screen.getByTestId('bus-log')).getAllByRole('row')).toHaveLength(3)
  })
})
