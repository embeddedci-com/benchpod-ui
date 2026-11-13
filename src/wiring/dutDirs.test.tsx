// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { coerceStoredWiring, effectiveWiring, laChannelMap, pinDutDirs, validateWiring, wiringDutDir, WIRING_DEFAULTS } from './model'
import { WiringEditor } from './WiringEditor'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

describe('pin directions (dut_dirs)', () => {
  it('gives every wired role a default, SWD included', () => {
    expect(pinDutDirs(WIRING_DEFAULTS)).toEqual({ 5: 'dut_output', 4: 'dut_input', 1: 'bidir', 2: 'bidir', 11: 'dut_input', 12: 'bidir' })
  })

  it('derives signals from their direction and lets dut_dirs win, case-insensitively', () => {
    const w = effectiveWiring({
      signals: [
        { name: 'READY', la: 9 },
        { name: 'TRIG', la: 10, direction: 'output' },
      ],
      dut_dirs: { uart_rx: 'bidir', ready: 'dut_input' },
    })
    expect(wiringDutDir(w, 'READY')).toBe('dut_input')
    expect(wiringDutDir(w, 'TRIG')).toBe('dut_input')
    expect(wiringDutDir(w, 'uart_rx')).toBe('bidir')
    expect(laChannelMap(w)[8].dutDir).toBe('dut_input')
    expect(laChannelMap(w)[2].dutDir).toBeNull()
  })

  it('validates and coerces like the server', () => {
    expect(validateWiring({ dut_dirs: [] }).errors[0].field).toBe('dut_dirs')
    expect(validateWiring({ dut_dirs: { uart_rx: 'output' } }).errors[0].field).toBe('dut_dirs.uart_rx')
    expect(validateWiring({ dut_dirs: { NOPE: 'bidir' } }).errors[0].message).toContain('not a wiring role or a signal name')
    expect(validateWiring({ signals: [{ name: 'READY', la: 9 }], dut_dirs: { READY: 'bidir' } }).errors).toEqual([])
    expect(coerceStoredWiring({ dut_dirs: { uart_rx: 'bidir', uart_tx: 'nope' } }).dut_dirs).toEqual({ uart_rx: 'bidir' })
    // Old profiles stay valid.
    expect(validateWiring({ uart_rx: 5 }).errors).toEqual([])
  })
})

describe('WiringEditor pin directions', () => {
  it('shows the defaults and saves an override, and a renamed signal keeps it', async () => {
    const onSave = vi.fn(async () => undefined)
    render(
      <MantineProvider>
        <WiringEditor profile={{ signals: [{ name: 'READY', la: 9 }], dut_dirs: { READY: 'bidir' } }} onSave={onSave} />
      </MantineProvider>,
    )
    const rx = screen.getByLabelText('UART RX direction', { selector: 'input' }) as HTMLInputElement
    expect(rx.value).toBe('board output (default)')
    expect((screen.getByLabelText('SWCLK direction', { selector: 'input' }) as HTMLInputElement).value).toBe('board input (default)')
    expect((screen.getByLabelText('READY direction', { selector: 'input' }) as HTMLInputElement).value).toBe('bidirectional')

    fireEvent.click(rx)
    fireEvent.click(await screen.findByRole('option', { name: 'bidirectional' }))
    fireEvent.change(screen.getByDisplayValue('READY'), { target: { value: 'DONE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save wiring' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(saved.dut_dirs).toEqual({ uart_rx: 'bidir', DONE: 'bidir' })
  })
})
