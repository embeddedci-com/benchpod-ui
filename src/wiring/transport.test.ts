import { describe, expect, it } from 'vitest'
import { debugPortMissing, debugTransport, jtagOnlyTarget } from './transport'

const swd = { swd_swclk: 11, swd_swdio: 12 }
const jtag = { jtag_tck: 11, jtag_tms: 12, jtag_tdi: 3, jtag_tdo: 4 }

describe('debugTransport', () => {
  it('uses SWD with SWD pins, JTAG with only JTAG pins, and nothing with neither', () => {
    expect(debugTransport(swd)).toBe('swd')
    expect(debugTransport(jtag)).toBe('jtag')
    expect(debugTransport({})).toBeNull()
    expect(debugTransport(null)).toBeNull()
  })
  it('needs all four JTAG pins', () => {
    expect(debugTransport({ jtag_tck: 1, jtag_tms: 2, jtag_tdi: 3 })).toBeNull()
    expect(debugTransport({ ...swd, jtag_tck: 11, jtag_tms: 12, jtag_tdi: 3 })).toBe('swd')
  })
  it('prefers SWD with both wired unless the target only has JTAG', () => {
    const both = { ...swd, ...jtag }
    expect(debugTransport(both, 'target/stm32f4x.cfg')).toBe('swd')
    expect(debugTransport(both)).toBe('swd')
    for (const t of ['target/esp32.cfg', 'target/esp32s2.cfg', 'target/gd32vf103.cfg', 'target/fe310.cfg', 'target/k210.cfg', 'target/riscv.cfg', 'riscv-x']) {
      expect(debugTransport(both, t)).toBe('jtag')
    }
    expect(debugTransport(both, 'target/esp32c3.cfg')).toBe('swd')
    expect(jtagOnlyTarget('')).toBe(false)
  })
  it('follows the profile debug_port before the automatic rule', () => {
    const both = { ...swd, ...jtag }
    expect(debugTransport({ ...both, debug_port: 'jtag' }, 'target/stm32f4x.cfg')).toBe('jtag')
    expect(debugTransport({ ...both, debug_port: 'swd' }, 'target/esp32.cfg')).toBe('swd')
    expect(debugTransport({ ...both, debug_port: null })).toBe('swd')
  })
  it('gives nothing, and names the fields, when the chosen port is incomplete', () => {
    const p = { ...swd, jtag_tck: 11, jtag_tms: 12, debug_port: 'jtag' as const }
    expect(debugTransport(p)).toBeNull()
    expect(debugPortMissing(p)).toEqual(['jtag_tdi', 'jtag_tdo'])
    expect(debugPortMissing({ ...jtag, debug_port: 'swd' })).toEqual(['swd_swclk', 'swd_swdio'])
    expect(debugPortMissing({ ...swd })).toEqual([])
  })
})
