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
const start: Wiring = { ...WIRING_UNDEFINED, la_mv: 3300, efuse: 1, uart_rx: 5, uart_tx: 4, signals: [{ name: 'READY', la: 9, direction: 'input', active_low: false, description: '' }] }

describe('PinsEditor', () => {
  it('shows a signal pin with its name and what the pod does', () => {
    render(<MantineProvider><Host start={start} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^LA9: READY/ }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('READY')
    expect(screen.getByText('No pull resistor on this pin.')).toBeTruthy()
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
})
