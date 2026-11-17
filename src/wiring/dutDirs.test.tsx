// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { coerceStoredWiring, effectiveWiring, laChannelMap, pinDutDirs, validateWiring, wiringDutDir, WIRING_DEFAULTS } from './model'

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
