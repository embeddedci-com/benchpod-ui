// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { BenchCall, BenchResult } from '../bench/benchCall'
import { BusDashboard } from './BusDashboard'
import { I2cTab, parseHexBytes, parseI2cAddr } from './I2cTab'
import { SpiTab } from './SpiTab'
import { CanTab, canDataOk, parseCanId } from './CanTab'
import { captureArgs } from './sendCapture'
import { i2cSendAgain, spiBursts } from './sendAgain'
import { PinStrip, pinColumns, pinWarningCount, dirLabel, ownerLabel, pinWarningLines, pinWarnings, pullLabel, warnBits, type LaPin } from './PinStrip'
import { logRow, logRows, loggedCall, nackWhere, type BusLogRow } from './busLog'

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
    expect(pinWarningLines({ la: 6, function: 'gpio', pull: 'up', warn: 1 })).toEqual(['LA6: a pull-up is on under a pin the pod drives; switch the pull-up off or use open drain'])
    expect(pinWarningLines({ la: 6, function: 'gpio', warn: 2 })[0]).toMatch(/^LA6: high or pulled up while the board is off/)
    expect(ownerLabel({ la: 1, function: 'i2cm_sda' })).toBe('I2C SDA')
    expect(ownerLabel({ la: 1, function: 'gpio', gpio: 'open_drain' })).toBe('gpio od')
  })

  it('fits 14, 7 or 4 pins in a row', () => {
    expect(pinColumns(0)).toBe(14)
    expect(pinColumns(1100)).toBe(14)
    expect(pinColumns(900)).toBe(7)
    expect(pinColumns(380)).toBe(4)
  })

  it('says direction and pull in words', () => {
    expect(dirLabel({ la: 1, function: 'none', dir: 'dut_input' })).toBe('board in')
    expect(dirLabel({ la: 1, function: 'none', dir: 'dut_output' })).toBe('board out')
    expect(dirLabel({ la: 1, function: 'none', dir: 'bidir' })).toBe('both')
    expect(dirLabel({ la: 1, function: 'none', dir: 'unknown' })).toBe('not set')
    expect(dirLabel({ la: 1, function: 'none' })).toBe('not set')
    expect(pullLabel({ la: 1, function: 'none', pull: 'up', pull_on: true })).toBe('pull-up on')
    expect(pullLabel({ la: 7, function: 'none', pull: 'down', pull_on: false })).toBe('pull-down off')
    expect(pullLabel({ la: 9, function: 'none', pull: null })).toBe('no pull')
  })

  it('draws 14 pins with names, owners and a warning with a plain explanation', async () => {
    const { call } = fake({
      la_pins: () => ok(pins({ 1: { function: 'i2cm_sda', pull_on: true, dir: 'bidir' }, 3: { function: 'gpio', gpio: 'output', level: 1, pull_on: true, warn: 1 } })),
    })
    const names = ['i2c_sda', 'i2c_scl', 'READY']
    wrap(<PinStrip call={call} names={names} />)
    await screen.findByTitle('Used by: I2C SDA')
    for (let la = 1; la <= 14; la++) expect(screen.getByTestId(`pin-${la}`)).toBeTruthy()
    expect(within(screen.getByTestId('pin-3')).getByText('READY')).toBeTruthy()
    expect(within(screen.getByTestId('pin-3')).getByText('gpio')).toBeTruthy()
    const icon = screen.getByLabelText(/^LA3 warning: /)
    // Each pin is a named group: the strip reads in words without the hover.
    expect(screen.getByRole('group', { name: /^LA3, READY, gpio/ })).toBeTruthy()
    expect(icon.tabIndex).toBe(0) // the explanation opens on focus too
    fireEvent.mouseEnter(icon)
    expect(await screen.findByText(/A pull resistor is on under a pin the pod drives/)).toBeTruthy()
    expect(screen.queryByLabelText(/^LA1 warning/)).toBeNull()
    // The warning is also text under the strip, not only a hover.
    expect(screen.getByTestId('pin-warnings').textContent).toContain('LA3: a pull-up is on under a pin the pod drives')
    expect(within(screen.getByTestId('pin-1')).getByText('both')).toBeTruthy()
    expect(within(screen.getByTestId('pin-1')).getByText('pull-up on')).toBeTruthy()
    expect(within(screen.getByTestId('pin-4')).getByText('not wired')).toBeTruthy()
    expect(within(screen.getByTestId('pin-4')).getByText('not set')).toBeTruthy()
  })

  it('counts warnings, and draws data the host passes without reading the pod', () => {
    const data = { pins: pins({ 3: { function: 'gpio', warn: 3 }, 6: { function: 'gpio', pull: 'up', pull_on: true, warn: 1 } }), busy: false, load: async () => {} }
    expect(pinWarningCount(data.pins)).toBe(3)
    expect(pinWarningCount(null)).toBe(0)
    const { call, seen } = fake({})
    wrap(<PinStrip call={call} data={data} />)
    expect(screen.getByTestId('pin-warnings').textContent).toContain('LA6: a pull-up is on')
    expect(seen).toHaveLength(0)
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

describe('CanTab', () => {
  it('parses ids and data lengths', () => {
    expect(parseCanId('0x123', false)).toBe(0x123)
    expect(parseCanId('0x800', false)).toBeNaN()
    expect(parseCanId('0x18DAF110', true)).toBe(0x18daf110)
    expect(canDataOk(8, false)).toBe(true)
    expect(canDataOk(9, false)).toBe(false)
    expect(canDataOk(64, true)).toBe(true)
  })

  it('opens, sends a frame and shows the pod error as is', async () => {
    const { call, seen } = fake({
      can_open: (a) => ok({ open: true, bitrate: a.bitrate, mode: a.mode, term: a.term, fd: false }),
      can_write: () => err('CAN not open: call can_open first'),
    })
    wrap(<CanTab call={call} />)
    fireEvent.click(screen.getByLabelText('120 ohm termination'))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect((await screen.findByTestId('can-session')).textContent).toBe('open: 500 kbit/s, on the bus, terminated')
    expect(seen[0].args).toEqual({ bitrate: 500000, mode: 'normal', term: true })
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: '0x18daf110' } })
    expect(screen.getByText('up to 0x7ff')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Extended (29-bit)'))
    fireEvent.change(screen.getByLabelText('Data (hex)'), { target: { value: '02 01 0d' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('CAN not open: call can_open first')).toBeTruthy()
    expect(seen[1]).toMatchObject({ tool: 'can_write', args: { can_id: 0x18daf110, data: [2, 1, 13], ext: true } })
  })

  it('logs one row per frame read, and nothing for a poll that read none', () => {
    const frames = ok({ frames: [{ id: 0x7e8, data: [3, 0x41, 0x0d, 0x32], ext: false, rtr: false, ts_ms: 1200 }, { id: 0x18daf110, data: [], ext: true, rtr: true, ts_ms: 1210 }] })
    const rows = logRows(0, 'CAN', 'can_read', { timeout: 0 }, frames, true)
    expect(rows.map((r) => r.in)).toEqual(['0x7E8 [4] 03 41 0d 32', '0x18DAF110 ext RTR'])
    expect(rows[0].note).toBe('received at 1200 ms')
    expect(logRows(0, 'CAN', 'can_read', {}, ok({ frames: [] }), true)).toEqual([])
    expect(logRows(0, 'CAN', 'can_read', {}, ok({ frames: [] }), false)[0].note).toBe('no frames')
    expect(logRow(1, 0, 'CAN', 'can_write', { can_id: 0x123, data: [1, 2], ext: false }, ok({ queued: true })).out).toBe('0x123 [2] 01 02')
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

describe('send and capture', () => {
  it('sizes the capture for the transaction', () => {
    const i2c = captureArgs({ bus: 'i2c', addr: 0x76, write_hex: 'd0', read: 1 }, 100_000)
    expect(i2c).toMatchObject({ sample_rate_hz: 1_000_000, trigger_timeout: 2 })
    expect(i2c.samples).toBeGreaterThanOrEqual(2048)
    const spi = captureArgs({ bus: 'spi', tx_hex: '9f000000', spi_mode: 0, spi_hz: 6_000_000 })
    expect(spi.sample_rate_hz).toBe(48_000_000)
    const long = captureArgs({ bus: 'i2c', addr: 0x50, write_hex: '00'.repeat(32), read: 32 }, 100_000)
    expect(long.samples).toBeGreaterThan(9000)
    expect(captureArgs({ bus: 'gpio', la: 3, level: 1 })).toMatchObject({ samples: 2064, sample_rate_hz: 1_000_000, send: { bus: 'gpio', la: 3, level: 1 } })
  })

  it('logs the send with the capture and points at it in the trace', async () => {
    let seq = 7
    const { call, seen } = fake({
      wiring: () => ok({ pins: [{ la: 1, wired_to: 'i2c_sda' }, { la: 2, wired_to: 'i2c_scl' }] }),
      la_pins: () => ok(pins()),
      capture_la: () => ok({ samples: 2112, sample_rate_hz: 1e6, trigger: 'LA1 falling', pre_samples: 64, channels: [], send: { bus: 'i2c', ack: true, rx_hex: '60', nack_at: null } }),
      decode_la: () => ok({ protocol: 'i2c', transactions: 1 }),
    })
    const fetchCapture = vi.fn(async (kind: string) => (kind === 'la' ? { seq, sample_rate_hz: 1e6, count: 2112, edges: [] } : { seq: 0 })) as never
    wrap(<BusDashboard call={call} fetchCapture={fetchCapture} />)
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: '0x76' } })
    fireEvent.change(screen.getByLabelText('Write (hex)'), { target: { value: 'd0' } })
    fireEvent.change(screen.getByLabelText('Read bytes'), { target: { value: '1' } })
    fireEvent.click(screen.getByLabelText('Capture it'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByTestId('i2c-result')).textContent).toBe('0x76 ACK: 60')
    const cap = seen.find((x) => x.tool === 'capture_la')!
    expect(cap.args.send).toEqual({ bus: 'i2c', addr: 0x76, write_hex: 'd0', read: 1 })
    expect(cap.args.trigger_la).toBeUndefined()
    expect(seen.find((x) => x.tool === 'decode_la')?.args).toEqual({ protocol: 'i2c', sda: 1, scl: 2, capture: 'last', max_items: 1 })
    expect(seen.some((x) => x.tool === 'i2c_transfer')).toBe(false)

    const log = await screen.findByTestId('bus-log')
    const row = within(log).getAllByRole('row')[1]
    expect(row.textContent).toContain('0x76 W d0 R 1, captured')
    expect(row.textContent).toContain('2,112 samples at 1 MS/s, trigger LA1 falling')
    fireEvent.click(within(row).getByRole('button', { name: 'Trace' }))
    await waitFor(() => expect(screen.queryByTestId('trace-note')).toBeNull())
    seq = 8
    fireEvent.click(within(row).getByRole('button', { name: 'Trace' }))
    expect((await screen.findByTestId('trace-note')).textContent).toContain('A newer capture replaced')
  })

  it('a host with its own capture and pins: no capture view, pin strip or Console tab until a send', async () => {
    const { call } = fake({
      wiring: () => ok({ pins: [{ la: 1, wired_to: 'i2c_sda' }, { la: 2, wired_to: 'i2c_scl' }] }),
      la_pins: () => ok(pins()),
      capture_la: () => ok({ samples: 2112, sample_rate_hz: 1e6, channels: [], send: { bus: 'i2c', ack: true, rx_hex: '60', nack_at: null } }),
      decode_la: () => ok({ protocol: 'i2c', transactions: 1 }),
    })
    const fetchCapture = vi.fn(async (kind: string) => (kind === 'la' ? { seq: 5, sample_rate_hz: 1e6, count: 2112, edges: [] } : { seq: 0 })) as never
    const onPinsChange = vi.fn()
    wrap(<BusDashboard call={call} fetchCapture={fetchCapture} capture="after-send" pins={false} consoleTab={false} onPinsChange={onPinsChange} />)
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: '0x76' } })
    expect(screen.queryByTestId('pin-strip')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Console' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Capture' })).toBeNull()
    expect(screen.queryByTestId('send-trace')).toBeNull()
    fireEvent.change(screen.getByLabelText('Write (hex)'), { target: { value: 'd0' } })
    fireEvent.click(screen.getByLabelText('Capture it'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const trace = await screen.findByTestId('send-trace')
    expect(trace.textContent).toContain('Capture from the last send')
    expect(within(trace).queryByRole('button', { name: 'Capture' })).toBeNull()
    expect(onPinsChange).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Close the capture from the last send'))
    await waitFor(() => expect(screen.queryByTestId('send-trace')).toBeNull())
  })

  it('a send that fails inside the capture shows its error', async () => {
    const { call } = fake({
      wiring: () => ok({ pins: [] }),
      la_pins: () => ok(pins()),
      capture_la: () => ok({ samples: 2048, sample_rate_hz: 1e6, channels: [], send: { bus: 'gpio', error: 'gpio send: LA3 is not a GPIO output' } }),
    })
    const fetchCapture = (async () => ({ seq: 3, sample_rate_hz: 1e6, count: 2048, edges: [] })) as never
    wrap(<BusDashboard call={call} fetchCapture={fetchCapture} initialTab="gpio" />)
    fireEvent.click(await screen.findByLabelText('Capture it'))
    fireEvent.click(screen.getByRole('button', { name: 'Write 1' }))
    expect(await screen.findAllByText(/gpio send: LA3 is not a GPIO output/)).toHaveLength(2)
  })
})

const seg = (type: string, value?: string) => ({ type, start_us: 0, end_us: 1, value })
const txn = (id: number, segs: ReturnType<typeof seg>[]) => ({ id, direction: 'write+read', address: '0x76', start_us: 0, end_us: 100, ok: true, segments: segs })

describe('send again', () => {
  it('turns a decoded I2C transaction into a send', () => {
    const t = txn(1, [seg('start'), seg('address-write', '0x76'), seg('ack'), seg('data-write', '0xD0'), seg('ack'), seg('repeat-start'), seg('address-read', '0x76'), seg('ack'), seg('data-read', '0x60'), seg('nack'), seg('stop')])
    expect(i2cSendAgain(t)).toEqual({ bus: 'i2c', addr: 0x76, write_hex: 'd0', read: 1 })
    expect(i2cSendAgain({ ...t, address: '' })).toBeNull()
  })

  it('groups SPI words into transfers by the gaps between them', () => {
    const f = (index: number, start: number, mosi: number) => ({ index, start_us: start, end_us: start + 1, mosi, miso: 0, mosi_hex: '', miso_hex: '' })
    const b = spiBursts([f(1, 0, 0x9f), f(2, 1.1, 0), f(3, 2.2, 0), f(4, 50, 0x05), f(5, 51.1, 0)])
    expect([...b.entries()]).toEqual([
      [1, { bus: 'spi', tx_hex: '9f0000' }],
      [4, { bus: 'spi', tx_hex: '0500' }],
    ])
  })

  it('a Send again on the decode table sends it from the I2C tab', async () => {
    const t = txn(1, [seg('start'), seg('address-write', '0x76'), seg('ack'), seg('data-write', '0xD0'), seg('ack'), seg('repeat-start'), seg('address-read', '0x76'), seg('ack'), seg('data-read', '0x60'), seg('nack'), seg('stop')])
    HTMLCanvasElement.prototype.getContext = (() => null) as never
    const { call, seen } = fake({
      wiring: () => ok({ pins: [{ la: 1, wired_to: 'i2c_sda' }, { la: 2, wired_to: 'i2c_scl' }] }),
      la_pins: () => ok(pins()),
      i2c_transfer: (a) => ok({ addr: a.addr, ack: true, rx_hex: '60' }),
    })
    const fetchCapture = (async (kind: string) =>
      kind === 'la'
        ? { seq: 5, sample_rate_hz: 1e6, count: 1000, edges: [[0, 3], [10, 2]] }
        : kind === 'decode'
          ? { seq: 5, protocol: 'i2c', channels: { sda: 1, scl: 2 }, transactions: [t] }
          : { seq: 0 }) as never
    wrap(<BusDashboard call={call} fetchCapture={fetchCapture} initialTab="gpio" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Fill the send box with transaction 1' }))
    expect(((await screen.findByLabelText('Write (hex)')) as HTMLInputElement).value).toBe('d0')
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('0x76')
    expect(seen.some((x) => x.tool === 'i2c_transfer')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Send transaction 1 again' }))
    expect((await screen.findByTestId('i2c-result')).textContent).toBe('0x76 ACK: 60')
    expect(seen.filter((x) => x.tool === 'i2c_transfer').map((x) => x.args)).toEqual([{ addr: 0x76, write_hex: 'd0', read: 1 }])
  })
})
