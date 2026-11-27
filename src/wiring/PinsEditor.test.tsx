// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { PinsEditor } from './PinsEditor'
import { WIRING_UNDEFINED, type Wiring } from './model'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

let last: Wiring
function Host({ start }: { start: Wiring }) {
  const [w, setW] = useState(start)
  last = w
  return <PinsEditor wiring={w} onChange={(p) => setW((x) => ({ ...x, ...p }))} />
}
const start: Wiring = { ...WIRING_UNDEFINED, la_mv: 3300, supply: '5v', uart_rx: 5, uart_tx: 4, signals: [{ name: 'READY', la: 9, direction: 'input', active_low: false, description: '' }] }

describe('PinsEditor', () => {
  it('shows a signal pin with its name and what the pod does', () => {
    render(<MantineProvider><Host start={start} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA9: READY/ }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('READY')
    expect(screen.getByText('No pull resistor on this pin.')).toBeTruthy()
  })
  it('offers the 3.3 V and 1.8 V supplies only on a pod that has them', async () => {
    const { unmount } = render(<MantineProvider><Host start={start} /></MantineProvider>)
    fireEvent.click(screen.getByLabelText('Supply', { selector: 'input' }))
    expect(screen.queryByRole('option', { name: '3.3 V' })).toBeNull()
    unmount()
    function WithRails() {
      const [w, setW] = useState(start)
      last = w
      return <PinsEditor wiring={w} switchedSupplies onChange={(p) => setW((x) => ({ ...x, ...p }))} />
    }
    render(<MantineProvider><WithRails /></MantineProvider>)
    fireEvent.click(screen.getByLabelText('Supply', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: '3.3 V' }))
    expect(last.supply).toBe('3v3')
  })
  it('moves a role to the clicked pin', async () => {
    render(<MantineProvider><Host start={start} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA3: free/ }))
    fireEvent.click(screen.getByLabelText('Used for', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: 'UART RX (board TX), now on LA5' }))
    expect(last.uart_rx).toBe(3)
    expect(screen.getByRole('button', { name: /^LA5: free/ })).toBeTruthy()
  })
  it('switches a pin\'s pull-up on and marks the tile', () => {
    render(<MantineProvider><Host start={start} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA1: free/ }))
    fireEvent.click(screen.getByLabelText(/Pull-up \(4.7k\)/))
    expect(last.pulls).toEqual([1])
    expect(screen.getByRole('button', { name: 'LA1: free, pull-up on' })).toBeTruthy()
  })
  it('shows the baud on a UART pin', () => {
    render(<MantineProvider><Host start={start} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA4: UART TX/ }))
    expect(screen.getByLabelText('Baud (both UART pins)', { selector: 'input' })).toBeTruthy()
  })
  it('sets the UART parity and stop bits on a UART pin', async () => {
    render(<MantineProvider><Host start={start} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA5: UART RX/ }))
    fireEvent.click(screen.getByLabelText('Parity', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Even', hidden: true }))
    fireEvent.click(screen.getByLabelText('Stop bits', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: '2', hidden: true }))
    expect([last.uart_parity, last.uart_stop_bits]).toEqual(['even', 2])
  })
  it('shows what the pod reports: a warning mark on the pin, the words in its editor', () => {
    const live = [{ la: 6, function: 'gpio', gpio: 'output', level: 1, pull: 'up', pull_on: true, warn: 1 }]
    render(<MantineProvider><PinsEditor wiring={start} onChange={() => {}} live={live} /></MantineProvider>)
    expect(screen.getByRole('button', { name: 'LA6: free, warning' })).toBeTruthy()
    // It opens on the pin with the warning.
    expect(screen.getByTestId('pin-live').textContent).toMatch(/gpio out, high, pull-up on/)
    expect(screen.getByText(/A pull resistor is on under a pin the pod drives/)).toBeTruthy()
  })
  it('shows the Debug port select only when both SWD and JTAG pins are set, and saves it', async () => {
    const swdOnly: Wiring = { ...start, swd_swclk: 11, swd_swdio: 12 }
    const { unmount } = render(<MantineProvider><Host start={swdOnly} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA11: / }))
    expect(screen.queryByLabelText('Debug port', { selector: 'input' })).toBeNull()
    unmount()
    render(<MantineProvider><Host start={{ ...swdOnly, jtag_tck: 11, jtag_tms: 12, jtag_tdi: 3, jtag_tdo: 6 }} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA11: / }))
    fireEvent.click(screen.getByLabelText('Debug port', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: 'JTAG', hidden: true }))
    expect(last.debug_port).toBe('jtag')
    fireEvent.click(screen.getByLabelText('Debug port', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Auto', hidden: true }))
    expect(last.debug_port).toBeNull()
  })

  it('adds a monitor, edits it and removes it; the key is undefined when empty', async () => {
    render(<MantineProvider><Host start={start} /></MantineProvider>)
    expect(screen.getByRole('button', { name: 'Help: current monitors' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add monitor' }))
    expect(last.monitors).toEqual([{ chip: 'ina226', addr: 0x40, shunt_ohm: 10 }])
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '0x41' } })
    fireEvent.change(screen.getByLabelText('Shunt (ohm)'), { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dut' } })
    expect(last.monitors).toEqual([{ chip: 'ina226', addr: 0x41, shunt_ohm: 0.5, name: 'dut' }])
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.change(screen.getByLabelText('SDA (LA)'), { target: { value: '13' } })
    expect(last.monitors[0].sda).toBe(13)
    fireEvent.change(screen.getByLabelText('Shunt (ohm)'), { target: { value: '' } })
    expect('shunt_ohm' in last.monitors[0]).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add monitor' }))
    expect(last.monitors[1].addr).toBe(0x40)
    fireEvent.click(screen.getByRole('button', { name: 'Remove monitor 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove monitor 1' }))
    expect(last.monitors).toBeUndefined()
  })
  it('shows the errors inline and the INA3221 channel', () => {
    const errors = new Map([['monitors[0].addr', 'monitors[0].addr must be a whole number 64-67 (0x40-0x43) for the ina3221']])
    const w = { ...start, monitors: [{ chip: 'ina3221' as const, addr: 0x44, shunt_ohm: 1 }] }
    render(<MantineProvider><PinsEditor wiring={w} onChange={() => {}} errors={errors} /></MantineProvider>)
    expect(screen.getByText(/64-67 \(0x40-0x43\)/)).toBeTruthy()
    expect(screen.getByLabelText('Channel', { selector: 'input' })).toBeTruthy()
  })
})
