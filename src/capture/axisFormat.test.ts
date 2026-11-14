import { describe, expect, it } from 'vitest'
import { axisLabel, niceStep, readoutLabel, valueLabel } from './axisFormat'

const labels = (vmin: number, vmax: number, unit = 'V') => {
  const step = niceStep(vmax - vmin)
  const out: string[] = []
  const maxAbs = Math.max(Math.abs(vmin), Math.abs(vmax))
  for (let i = Math.ceil(vmin / step); i * step <= vmax; i++) out.push(axisLabel(i * step, step, unit, maxAbs))
  return out
}

describe('analog axis labels', () => {
  it('reads millivolts for a trace near 0 V with millivolt noise', () => {
    const l = labels(-0.0042, 0.0061)
    expect(new Set(l).size).toBe(l.length) // every label differs
    expect(l).toEqual(['-4 mV', '-2 mV', '0 mV', '2 mV', '4 mV', '6 mV'])
    expect(l.some((x) => x === '0.00 V')).toBe(false)
  })

  it('keeps volts for a wide span, with the decimals the step needs', () => {
    expect(labels(-0.3, 3.6)).toEqual(['0.0 V', '0.5 V', '1.0 V', '1.5 V', '2.0 V', '2.5 V', '3.0 V', '3.5 V'])
    expect(labels(1.1, 1.36)).toEqual(['1.10 V', '1.15 V', '1.20 V', '1.25 V', '1.30 V', '1.35 V'])
    expect(labels(0.98, 1.0205)).toEqual(['0.980 V', '0.985 V', '0.990 V', '0.995 V', '1.000 V', '1.005 V', '1.010 V', '1.015 V', '1.020 V'])
  })

  it('goes below a millivolt and never prints -0', () => {
    expect(labels(-0.0006, 0.0006)).toEqual(['-0.4 mV', '-0.2 mV', '0.0 mV', '0.2 mV', '0.4 mV'])
    expect(axisLabel(-1e-12, 0.002, 'V')).toBe('0 mV')
  })

  it('leaves other units (mA) in their unit', () => {
    expect(labels(3.9, 4.1, 'mA')).toEqual(['3.90 mA', '3.92 mA', '3.94 mA', '3.96 mA', '3.98 mA', '4.00 mA', '4.02 mA', '4.04 mA', '4.06 mA', '4.08 mA', '4.10 mA'])
  })

  it('formats min/max labels and the hover readout by scale', () => {
    expect(valueLabel(3.3, 3.3, 'V')).toBe('3.30 V')
    expect(valueLabel(0.0021, 0.004, 'V')).toBe('2.10 mV')
    expect(readoutLabel(0.00213, 'V')).toBe('2.13 mV')
    expect(readoutLabel(1.2345, 'V')).toBe('1.234 V')
  })
})
