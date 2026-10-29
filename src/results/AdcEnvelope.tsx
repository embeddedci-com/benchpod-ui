import { useEffect, useRef } from 'react'
import { Box, Group, Text, useComputedColorScheme } from '@mantine/core'

/** The part of the MCP server's capture_adc result this view draws. */
export type AdcCapture = {
  samples: number
  sample_rate_hz: number
  duration: number
  unit?: 'V' | 'A'
  mean: number
  min: number
  max: number
  peak_to_peak: number
  rms_ac?: number
  dominant_frequency_hz?: number | null
  envelope_step: number
  envelope_min: number[]
  envelope_max: number[]
  trigger?: string | null
}

export function isAdcCapture(v: unknown): v is AdcCapture {
  const o = v as AdcCapture
  return !!o && Array.isArray(o.envelope_min) && Array.isArray(o.envelope_max) && typeof o.envelope_step === 'number'
}

export function fmtSi(v: number, unit: string): string {
  const a = Math.abs(v)
  if (a === 0) return `0 ${unit}`
  if (a >= 1e6) return `${(v / 1e6).toPrecision(3)} M${unit}`
  if (a >= 1e3) return `${(v / 1e3).toPrecision(3)} k${unit}`
  if (a >= 1) return `${v.toPrecision(3)} ${unit}`
  if (a >= 1e-3) return `${(v * 1e3).toPrecision(3)} m${unit}`
  if (a >= 1e-6) return `${(v * 1e6).toPrecision(3)} µ${unit}`
  return `${(v * 1e9).toPrecision(3)} n${unit}`
}

/** Whether the capture holds more than the input's noise: a frequency of noise means nothing. */
export function hasSignal(c: AdcCapture): boolean {
  return c.peak_to_peak > ((c.unit ?? 'V') === 'A' ? 0.0002 : 0.02)
}

/** An ADC capture as a min/max envelope over time, with its summary numbers. */
export function AdcEnvelope({ capture, height = 160 }: { capture: AdcCapture; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scheme = useComputedColorScheme('dark')
  const unit = capture.unit ?? 'V'

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth
    const h = height
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const g = cv.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    const dark = scheme === 'dark'
    const c = {
      bg: dark ? '#14161a' : '#fbfbfc',
      grid: dark ? '#2a2e35' : '#e6e8ec',
      label: dark ? '#9aa3ad' : '#5c6670',
      trace: dark ? '#4dabf7' : '#1c7ed6',
      fill: dark ? 'rgba(77,171,247,0.25)' : 'rgba(28,126,214,0.18)',
    }
    const padL = 52
    const padB = 18
    const padT = 6
    g.fillStyle = c.bg
    g.fillRect(0, 0, w, h)
    const mins = capture.envelope_min
    const maxs = capture.envelope_max
    const n = Math.min(mins.length, maxs.length)
    if (n === 0) return
    let lo = Math.min(...mins.slice(0, n))
    let hi = Math.max(...maxs.slice(0, n))
    // A floor on the vertical span, so millivolts of noise on a quiet input stay a flat line
    // instead of filling the chart like a signal.
    const minSpan = unit === 'A' ? 0.001 : 0.2
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2
      lo = mid - minSpan / 2
      hi = mid + minSpan / 2
    }
    const span = hi - lo
    lo -= span * 0.08
    hi += span * 0.08
    const pw = w - padL - 8
    const ph = h - padT - padB
    const y = (v: number) => padT + ph - ((v - lo) / (hi - lo)) * ph
    const x = (i: number) => padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw)

    g.strokeStyle = c.grid
    g.fillStyle = c.label
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    g.lineWidth = 1
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4
      const yy = Math.round(y(v)) + 0.5
      g.beginPath()
      g.moveTo(padL, yy)
      g.lineTo(w - 8, yy)
      g.stroke()
      g.fillText(fmtSi(v, unit), 2, yy + 3)
    }
    const dur = capture.envelope_step * n
    for (let k = 0; k <= 4; k++) {
      const xx = padL + (pw * k) / 4
      g.fillText(fmtSi((dur * k) / 4, 's'), Math.min(xx, w - 48), h - 4)
    }

    g.fillStyle = c.fill
    g.beginPath()
    for (let i = 0; i < n; i++) g.lineTo(x(i), y(maxs[i]))
    for (let i = n - 1; i >= 0; i--) g.lineTo(x(i), y(mins[i]))
    g.closePath()
    g.fill()
    g.strokeStyle = c.trace
    g.lineWidth = 1.25
    g.beginPath()
    for (let i = 0; i < n; i++) g.lineTo(x(i), y((maxs[i] + mins[i]) / 2))
    g.stroke()
  }, [capture, height, scheme, unit])

  return (
    <Box>
      <canvas ref={ref} style={{ width: '100%', height, display: 'block', borderRadius: 6 }} />
      <Group gap="md" mt={4}>
        <Stat label="mean" value={fmtSi(capture.mean, unit)} />
        <Stat label="min" value={fmtSi(capture.min, unit)} />
        <Stat label="max" value={fmtSi(capture.max, unit)} />
        <Stat label="p-p" value={fmtSi(capture.peak_to_peak, unit)} />
        {hasSignal(capture) && capture.dominant_frequency_hz ? <Stat label="f" value={fmtSi(capture.dominant_frequency_hz, 'Hz')} /> : null}
        <Stat label="rate" value={fmtSi(capture.sample_rate_hz, 'S/s')} />
        {capture.trigger ? <Stat label="trigger" value={capture.trigger} /> : null}
      </Group>
    </Box>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Text size="xs" ff="monospace" c="dimmed">
      {label} <Text span size="xs" ff="monospace" c="bright">{value}</Text>
    </Text>
  )
}
