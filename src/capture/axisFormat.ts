/**
 * Labels for an analog axis, with the precision the visible span needs: a trace sitting near
 * 0 V with millivolt noise reads "-2 mV, 0 mV, 2 mV", not "0.00 V" on every line.
 */

/** A "nice" grid step (1, 2 or 5 times a power of ten) for about `lines` lines over `span`. */
export function niceStep(span: number, lines = 5): number {
  const raw = span / lines
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag
}

/** Decimals that show a step of `step` (0.25 needs 2, 0.5 needs 1, 2 needs 0). */
function decimalsFor(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0
  for (let d = 0; d < 6; d++) {
    const scaled = step * Math.pow(10, d)
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) return d
  }
  return 6
}

/**
 * One axis label: `v` on a grid of `step`, in `unit`. Volts switch to millivolts when the step is
 * under 10 mV and the axis stays under 1 V (`maxAbs`, the largest value on it; a 1.00 V level with
 * fine steps reads 0.985 V, not 985 mV). Values snap to the grid (no "-0" or float dust).
 */
export function axisLabel(v: number, step: number, unit: string, maxAbs = Math.abs(v)): string {
  let value = v
  let s = step
  let u = unit
  if (unit === 'V' && step < 0.01 && maxAbs < 1) {
    value = v * 1000
    s = step * 1000
    u = 'mV'
  }
  const snapped = s > 0 ? Math.round(value / s) * s : value
  const d = Math.min(6, Math.max(u === 'V' ? 1 : 0, decimalsFor(s)))
  const text = snapped.toFixed(d)
  return `${Number(text) === 0 ? (0).toFixed(d) : text} ${u}`
}

/** A min/max label for a track whose visible span is `span`: the precision of a fine grid on it. */
export function valueLabel(v: number, span: number, unit: string): string {
  return axisLabel(v, niceStep(Math.abs(span) || Math.abs(v) || 1, 50), unit, Math.abs(v))
}

/** The hover readout of one sample: 3 decimals in volts, millivolts under 0.1 V. */
export function readoutLabel(v: number, unit: string): string {
  if (unit === 'V' && Math.abs(v) < 0.1) return `${(v * 1000).toFixed(2)} mV`
  return `${v.toFixed(3)} ${unit}`
}
