// The arithmetic behind the generator's fault injection, segment builder and control loop: the
// same as the web app's (controlLoopCurve.ts, waveformPreview.ts) and the Python SDK's, so a
// curve, a fault level or a segmented signal comes out the same from either app.

export const CODE_MAX = 65535

/** The range an output spans in its own unit: volts, or amps on the 4-20 mA output (nominal). */
export function pathRange(path: string): { min: number; max: number } {
  switch (path) {
    case '5v':
      return { min: 0, max: 5 }
    case '12v':
      return { min: -12, max: 12 }
    case 'current_out':
      return { min: 0.004, max: 0.0201 }
    default:
      return { min: 0, max: 3.3 }
  }
}

/** A value on an output (volts, or amps on current_out) as the 16-bit DAC code that drives it. */
export function valueToCode(v: number, path: string): number {
  const r = pathRange(path)
  const c = Math.round(((v - r.min) / (r.max - r.min)) * CODE_MAX)
  return Number.isFinite(c) ? Math.max(0, Math.min(CODE_MAX, c)) : 0
}

/** The value a 16-bit DAC code drives on an output. */
export function codeToValue(code: number, path: string): number {
  const r = pathRange(path)
  return r.min + (code / CODE_MAX) * (r.max - r.min)
}

// --- Fault injection -----------------------------------------------------------------------

export type FaultType = 'flatline' | 'spike' | 'stuck'

/** The replay tool's fault: sample indices into the replayed waveform, and a raw DAC code. */
export type FaultSpec = { type: FaultType; start: number; width: number; level?: number }

/**
 * A fault over startPct..startPct+widthPct of a waveform of sampleCount samples. flatline and
 * spike hold level (volts, or amps on current_out) on the output; stuck holds the value just
 * before the window, which the host fills in from the samples (no level here).
 */
export function buildFault(type: FaultType, startPct: number, widthPct: number, sampleCount: number, level: number, path: string): FaultSpec {
  const n = Math.max(1, sampleCount)
  let start = Math.round((Math.max(0, Math.min(100, startPct)) / 100) * n)
  if (start >= n) start = n - 1
  let width = Math.max(1, Math.round((Math.max(0, Math.min(100, widthPct)) / 100) * n))
  if (start + width > n) width = n - start
  const f: FaultSpec = { type, start, width }
  if (type !== 'stuck') f.level = valueToCode(level, path)
  return f
}

// --- Segment builder -----------------------------------------------------------------------

export type SegmentShape = 'ramp' | 'hold' | 'step'
export type Segment = { shape: SegmentShape; durationMs: number; vStart: number; vEnd: number }

/** A starter signal: ramps, a hold, a fast step and a recovery (the web app's default). */
export const DEFAULT_SEGMENTS: Segment[] = [
  { shape: 'ramp', durationMs: 3000, vStart: 0, vEnd: 3 },
  { shape: 'hold', durationMs: 5000, vStart: 3, vEnd: 3 },
  { shape: 'step', durationMs: 20, vStart: 3, vEnd: 1.5 },
  { shape: 'hold', durationMs: 2000, vStart: 1.5, vEnd: 1.5 },
  { shape: 'ramp', durationMs: 1500, vStart: 1.5, vEnd: 3 },
]

/** The generation rate (0.2 ms resolution) and the most samples a segmented signal gets. */
export const SEG_RATE_HZ = 5000
export const SEG_MAX_SAMPLES = 65536

function segmentValue(s: Segment, i: number, n: number): number {
  if (s.shape === 'hold') return s.vStart
  if (s.shape === 'step') return s.vEnd
  return s.vStart + (s.vEnd - s.vStart) * (n <= 1 ? 1 : i / (n - 1))
}

/**
 * The segments as a uniform-rate array (the server's BuildSegmentedVolts): 5 kS/s, slower when
 * the total would pass maxSamples, and the rate that plays it back at the authored durations.
 * ramp goes from vStart to vEnd, hold stays at vStart, step jumps to vEnd.
 */
export function segmentsToSamples(segments: Segment[], maxSamples = SEG_MAX_SAMPLES): { samples: number[]; rateHz: number; durationS: number } {
  const segs = segments.filter((s) => s.durationMs > 0)
  const totalS = segs.reduce((t, s) => t + s.durationMs, 0) / 1000
  if (!(totalS > 0)) return { samples: [], rateHz: 0, durationS: 0 }
  const rate = Math.min(SEG_RATE_HZ, maxSamples / totalS)
  let samples: number[] = []
  for (const s of segs) {
    const n = Math.max(1, Math.round((s.durationMs / 1000) * rate))
    for (let i = 0; i < n; i++) samples.push(segmentValue(s, i, n))
  }
  if (samples.length > maxSamples) {
    // The one-sample floor on tiny segments can pass the cap: average blocks back down.
    const out: number[] = []
    const step = samples.length / maxSamples
    for (let k = 0; k < maxSamples; k++) {
      const a = Math.floor(k * step)
      const b = Math.max(a + 1, Math.floor((k + 1) * step))
      let sum = 0
      for (let j = a; j < b; j++) sum += samples[j]
      out.push(sum / (b - a))
    }
    samples = out
  }
  return { samples, rateHz: samples.length / totalS, durationS: totalS }
}

// --- Control loop --------------------------------------------------------------------------

export const CURVE_POINTS = 256
export type CurveShape = 'panel' | 'constant' | 'linear-up' | 'linear-down'

/**
 * The transfer curve as CURVE_POINTS output codes indexed by input. maxCode is the curve's top;
 * the ramps and the droop bottom out at zeroCode (the output's 0 V: mid-scale on 12v). panel is
 * the solar-panel I-V preset: flat near the top, a knee, then a cliff (sharper with knee).
 */
export function buildCurve(shape: CurveShape, maxCode: number, knee = 6, zeroCode = 0): number[] {
  const max = Math.max(0, Math.min(CODE_MAX, Math.round(maxCode)))
  const zero = Math.max(0, Math.min(max, Math.round(zeroCode)))
  const p = Math.max(1, knee)
  const out: number[] = []
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = i / (CURVE_POINTS - 1)
    const v =
      shape === 'panel'
        ? zero + Math.round((max - zero) * (1 - Math.pow(x, p)))
        : shape === 'constant'
          ? max
          : zero + (max - zero) * (shape === 'linear-up' ? x : 1 - x)
    out.push(Math.max(0, Math.min(CODE_MAX, Math.round(v))))
  }
  return out
}

/** The output the loop settles at for an input code: the firmware's LUT lookup (2048 entries). */
export function curveAt(curve: number[], inputCode: number): number {
  if (!curve.length) return 0
  const lut = Math.max(0, Math.min(CODE_MAX, Math.round(inputCode))) >> 5
  return curve[Math.min(curve.length - 1, Math.floor((lut * curve.length) / 2048))]
}

/** Response in % of a full step per tick as the loop's Q15 damping k (1..32767). */
export function responseToK(pct: number): number {
  const k = Math.round((pct / 100) * 32767)
  return Number.isFinite(k) ? Math.max(1, Math.min(32767, k)) : 1
}

export const percentToCode = (pct: number): number => Math.max(0, Math.min(CODE_MAX, Math.round((pct / 100) * CODE_MAX)))

const CLK_HZ = 48_000_000
const TICK_OVERHEAD = 7

/** The tick divider and per-tick step that sweep the whole input range once in seconds. */
export function sweepPlan(seconds: number): { tickDiv: number; step: number } {
  const want = Math.max(0, seconds)
  let tickDiv = Math.round((want * CLK_HZ) / (CODE_MAX + 1)) - TICK_OVERHEAD
  if (!Number.isFinite(tickDiv) || tickDiv < 8) tickDiv = 8
  if (tickDiv > 65535) tickDiv = 65535
  const ticks = (want * CLK_HZ) / (tickDiv + TICK_OVERHEAD)
  let step = ticks > 0 ? Math.round((CODE_MAX + 1) / ticks) : CODE_MAX
  if (!Number.isFinite(step) || step < 1) step = 1
  return { tickDiv, step: Math.min(CODE_MAX, step) }
}

/** How often the loop recomputes its output for a tick divider. */
export const loopRateHz = (tickDiv: number): number => CLK_HZ / Math.max(1, Math.round(tickDiv) + TICK_OVERHEAD)
