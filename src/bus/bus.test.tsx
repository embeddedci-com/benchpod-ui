// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { BenchCall, BenchResult } from '../bench/benchCall'
import { BusDashboard } from './BusDashboard'
import { I2cTab, parseHexBytes, parseI2cAddr } from './I2cTab'
import { SpiTab } from './SpiTab'
import { PinStrip, ownerLabel, pinWarnings, warnBits, type LaPin } from './PinStrip'
import { logRow, loggedCall, nackWhere, type BusLogRow } from './busLog'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

const ok = (structured: unknown): BenchResult => ({ text: JSON.stringify(structured), structured })
const err = (text: string): BenchResult => ({ text, is_error: true })

/** A fake BenchCall: a handler per tool, and the calls it saw. */
function fake(handlers: Record<string, (args: Record<string, unknown>) => BenchResult>) {
  const seen: { tool: string; args: Record<string, unknown>; poll?: boolean }[] = []
  const call: BenchCall = vi.fn(async (tool, args = {}, opts) => {
    seen.push({ tool, args, poll: opts?.poll })
    const h = handlers[tool]
    return h ? h(args) : err(`unknown tool ${tool}`)
  })
  return { call, seen }
}

const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>)

function pins(over: Partial<Record<number, Partial<LaPin>>> = {}) {
  return {
    pins: Array.from({ length: 14 }, (_, i) => ({ la: i + 1, function: 'none', pull: i < 6 ? 'up' : i < 8 ? 'down' : null, pull_on: false, in_use: false, ...over[i + 1] })),
    levels: null,
  }
}

describe('busLog', () => {
  it('a write-then-read that ACKs', () => {
    const r = logRow(1, 0, 'I2C', 'i2c_transfer', { addr: 0x48, write_hex: '0f', read: 2 }, ok({ addr: 0x48, ack: true, rx_hex: '1a2b' }))
    expect(r).toMatchObject({ out: '0x48 W 0f R 2', in: '1a 2b', status: 'ack' })
  })
  it('says which byte a NACK was on', () => {
    expect(nackWhere(0, 2)).toBe('NACK on the address')
    expect(nackWhere(2, 2)).toBe('NACK on byte 2')
    expect(nackWhere(3, 2)).toBe('NACK on the read address')
    const r = logRow(1, 0, 'I2C', 'i2c_transfer', { addr: 0x50, write_hex: '0001', read: 0 }, ok({ addr: 0x50, ack: false, rx_hex: '', nack_at: 0 }))
    expect(r).toMatchObject({ status: 'nack', note: 'NACK on the address' })
  })
  it('keeps the pod error text as is', () => {
    const r = logRow(1, 0, 'I2C', 'i2c_open', { sda: 9, scl: 10, hz: 400000, pullups: 'pod' }, err('pull-ups: LA9 has no pull resistor (pod pull-ups are on LA1-LA6)'))
    expect(r.status).toBe('error')
    expect(r.note).toBe('pull-ups: LA9 has no pull resistor (pod pull-ups are on LA1-LA6)')
  })
  it('shows the SCL rate the pod reports', () => {
    const r = logRow(1, 0, 'I2C', 'i2c_open', { hz: 400000 }, ok({ open: true, sda: 1, scl: 2, hz: 400000, pullups: 'pod' }))
    expect(r.note).toBe('pod runs SCL at 400 kHz')
    expect(r.out).toBe('open SDA i2c_sda SCL i2c_scl, 400 kHz, pod pull-ups')
  })
  it('a declined call is "not run", not an error', () => {
    const r = logRow(1, 0, 'GPIO', 'gpio_write', { la: [3], level: 1 }, { text: 'not run: you declined it', declined: true })
    expect(r.status).toBe('declined')
  })
  it('scan and gpio_wait', () => {
    expect(logRow(1, 0, 'I2C', 'i2c_scan', {}, ok({ found: [0x48, 0x76], found_hex: ['0x48', '0x76'] }))).toMatchObject({ out: 'scan 0x08..0x77', in: '0x48 0x76', note: '2 devices' })
    expect(logRow(1, 0, 'GPIO', 'gpio_wait', { la: 4, level: 1, timeout: 2 }, ok({ la: 4, level: 1, reached: false, waited: 2 }))).toMatchObject({ status: 'timeout' })
  })
  it('loggedCall skips polls and tools it is not asked to log', async () => {
    const rows: Omit<BusLogRow, 'id'>[] = []
    const { call } = fake({ uart_read: () => ok({ text: 'x' }), uart_write: () => ok({ written: 3 }) })
    const c = loggedCall(call, 'UART', (r) => rows.push(r), (t) => t === 'uart_write')
    await c('uart_read', {}, { poll: true })
    await c('uart_read', {})
    await c('uart_write', { text: 'hi', line_ending: 'lf' })
    expect(rows.map((r) => r.out)).toEqual(['hi\\n'])
  })
})

describe('I2C input', () => {
  it('parses addresses and hex', () => {
    expect(parseI2cAddr('0x48')).toBe(0x48)
    expect(parseI2cAddr('72')).toBe(72)
    expect(parseI2cAddr('48h')).toBe(0x48)
    expect(parseI2cAddr('0x80')).toBeNaN()
    expect(parseHexBytes('0x01 0x02, ff')).toBe('0102ff')
    expect(parseHexBytes('')).toBe('')
    expect(parseHexBytes('123')).toBeNull()
  })
})

describe('PinStrip', () => {
  it('reads warnings from bits or from the pod sentences', () => {
    expect(warnBits({ la: 1, function: 'gpio', warn: 3 })).toBe(3)
    expect(
      warnBits({ la: 2, function: 'gpio', warnings: ['LA2: target power is off while the pin is driven high or pulled up (this powers ...)'] }),
    ).toBe(2)
    expect(pinWarnings({ la: 1, function: 'gpio', warn: 1 })[0]).toMatch(/wastes current/)
    expect(ownerLabel({ la: 1, function: 'i2cm_sda' })).toBe('I2C SDA')
    expect(ownerLabel({ la: 1, function: 'gpio', gpio: 'open_drain' })).toBe('gpio od')
  })

  it('draws 14 pins with names, owners and a warning with a plain explanation', async () => {
    const { call } = fake({
      la_pins: () => ok(pins({ 1: { function: 'i2cm_sda', pull_on: true, dir: 'bidir' }, 3: { function: 'gpio', gpio: 'output', level: 1, pull_on: true, warn: 1 } })),
    })
    const names = ['i2c_sda', 'i2c_scl', 'READY']
    wrap(<PinStrip call={call} names={names} />)
    await screen.findByTitle('Owner: I2C SDA')
    for (let la = 1; la <= 14; la++) expect(screen.getByTestId(`pin-${la}`)).toBeTruthy()
    expect(within(screen.getByTestId('pin-3')).getByText('READY')).toBeTruthy()
    expect(within(screen.getByTestId('pin-3')).getByText('gpio')).toBeTruthy()
    const icon = screen.getByLabelText('LA3 warning')
    fireEvent.mouseEnter(icon)
    expect(await screen.findByText(/A pull resistor is on under a push-pull output/)).toBeTruthy()
    expect(screen.queryByLabelText('LA1 warning')).toBeNull()
  })

  it('shows the pod error when la_pins fails', async () => {
    const { call } = fake({ la_pins: () => err('not connected to a pod') })
    wrap(<PinStrip call={call} />)
    expect(await screen.findByText('not connected to a pod')).toBeTruthy()
  })
})

describe('I2cTab', () => {
  it('opens on the wired pins, sends and shows ACK and the bytes read', async () => {
    const { call, seen } = fake({
      i2c_open: (a) => ok({ open: true, sda: a.sda, scl: a.scl, hz: 400000, pullups: a.pullups }),
      i2c_transfer: (a) => ok({ addr: a.addr, ack: true, rx_hex: '60' }),
    })
    wrap(<I2cTab call={call} wiredSda={1} wiredScl={2} />)
    fireEvent.click(screen.getByLabelText('Speed', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: '400 kHz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect((await screen.findByTestId('i2c-session')).textContent).toContain('the pod runs SCL at 400 kHz')
    expect(seen.find((s) => s.tool === 'i2c_open')?.args).toEqual({ sda: 1, scl: 2, hz: 400000, pullups: 'pod' })

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '0x76' } })
    fireEvent.change(screen.getByLabelText('Write (hex)'), { target: { value: 'd0' } })
    fireEvent.change(screen.getByLabelText('Read bytes'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByTestId('i2c-result')).textContent).toBe('0x76 ACK: 60')
    expect(seen.find((s) => s.tool === 'i2c_transfer')?.args).toEqual({ addr: 0x76, write_hex: 'd0', read: 1 })
  })

  it('shows a NACK and the pod error text as is', async () => {
    const { call } = fake({
      i2c_transfer: () => ok({ addr: 0x50, ack: false, rx_hex: '', nack_at: 0 }),
      set_pull: () => err('set_pull: the LA bank is at 1.8 V; the pull resistors need 3.3 V'),
    })
    wrap(<I2cTab call={call} wiredSda={1} wiredScl={2} />)
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '0x50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByTestId('i2c-result')).textContent).toBe('0x50 NACK on the address')
    fireEvent.click(screen.getByRole('button', { name: 'Switch on' }))
    expect(await screen.findByText('set_pull: the LA bank is at 1.8 V; the pull resistors need 3.3 V')).toBeTruthy()
  })
})

describe('SpiTab', () => {
  it('sends on the wired pins and shows the bytes in and the rate the pod ran', async () => {
    const { call, seen } = fake({ spi_transfer: () => ok({ rx_hex: 'ffef4018', hz: 937500 }) })
    wrap(<SpiTab call={call} wired={{ sck: 3, mosi: 4, miso: 5, cs: 6 }} />)
    fireEvent.change(screen.getByLabelText('Out (hex)'), { target: { value: '9f 00 00 00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const res = await screen.findByTestId('spi-result')
    expect(res.textContent).toContain('ff ef 40 18')
    expect(res.textContent).toContain('938 kHz')
    expect(seen[0].args).toEqual({ tx_hex: '9f000000', sck: 3, mosi: 4, miso: 5, cs: 6, hz: 1000000, mode: 0 })
  })

  it('shows the pod error for mode 2 on old gateware as is', async () => {
    const msg = 'spi_master: mode 2 needs gateware v55+ (this pod runs v53)'
    const { call, seen } = fake({ spi_transfer: () => err(msg) })
    wrap(<SpiTab call={call} />)
    fireEvent.click(screen.getByLabelText('Mode', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: '2 (CPOL 1, CPHA 0)' }))
    fireEvent.change(screen.getByLabelText('Out (hex)'), { target: { value: 'aa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(msg)).toBeTruthy()
    expect(seen[0].args).toEqual({ tx_hex: 'aa', hz: 1000000, mode: 2 })
  })

  it('logs a transfer with what went out and came back', () => {
    const r = logRow(1, 0, 'SPI', 'spi_transfer', { tx_hex: '9f000000', mode: 3, cs: 6 }, ok({ rx_hex: 'ffef4018', hz: 1000000 }))
    expect(r).toMatchObject({ out: '9f 00 00 00 (mode 3, CS LA6)', in: 'ff ef 40 18', note: 'SCK 1 MHz', status: 'ok' })
  })
})

describe('BusDashboard', () => {
  it('logs each call from the tabs, with ACK, NACK and errors', async () => {
    const { call } = fake({
      wiring: () => ok({ pins: [{ la: 1, wired_to: 'i2c_sda' }, { la: 2, wired_to: 'i2c_scl' }] }),
      la_pins: () => ok(pins()),
      i2c_scan: () => ok({ found: [0x76], found_hex: ['0x76'] }),
      i2c_transfer: () => err('no I2C session: call i2c_open first'),
    })
    const fetchCapture = (async () => ({ seq: 0 })) as never
    wrap(<BusDashboard call={call} fetchCapture={fetchCapture} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan' }))
    await screen.findByTestId('i2c-scan')
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '0x76' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const log = await screen.findByTestId('bus-log')
    await waitFor(() => expect(within(log).getAllByRole('row')).toHaveLength(3))
    const [, newest, oldest] = within(log).getAllByRole('row')
    expect(newest.textContent).toContain('0x76 probe')
    expect(newest.textContent).toContain('no I2C session: call i2c_open first')
    expect(oldest.textContent).toContain('scan 0x08..0x77')
    expect(oldest.textContent).toContain('0x76')
    expect(oldest.textContent).toContain('I2C')
  })
})
