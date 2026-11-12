import { useEffect, useRef } from 'react'
import { Box, useComputedColorScheme } from '@mantine/core'

// A small canvas line chart in the look of the web app's waveform preview (WaveformCanvas):
// theme-aware, DPR-crisp, redrawn on resize. Several series share the x axis; each gets its own
// y range when `separateY` is set (stimulus signals in different units). Fault windows are red
// bands behind the traces, and `marker` puts a dot on the first series (the current value).

export type ChartSeries = { name: string; y: (number | null)[]; unit?: string }

export type ChartWindow = { from: number; to: number | null; label?: string }

type Props = {
  x: number[]
  series: ChartSeries[]
  windows?: ChartWindow[]
  marker?: { x: number; y: number } | null
  xUnit?: string
  height?: number
  placeholder?: string
  separateY?: boolean
  ariaLabel?: string
}

const SERIES_DARK = ['#f59e0b', '#4dabf7', '#69db7c', '#da77f2', '#ffa8a8', '#66d9e8']
const SERIES_LIGHT = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#e03131', '#0c8599']

export const seriesColor = (i: number, dark: boolean) => (dark ? SERIES_DARK : SERIES_LIGHT)[i % 6]

function fmt(v: number): string {
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1)
  return String(Number(v.toPrecision(4)))
}

export function LineChart({ x, series, windows = [], marker = null, xUnit = 's', height = 200, placeholder = 'Nothing to draw yet.', separateY = false, ariaLabel }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scheme = useComputedColorScheme('light')
  const dark = scheme === 'dark'

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let frame = 0
    const draw = () => {
      frame = 0
      const rect = cv.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const h = height
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const c = dark
        ? { bg: '#0f1218', grid: '#242c3a', dim: '#8892a4', fault: 'rgba(248, 113, 113, 0.16)', faultLine: '#f87171' }
        : { bg: '#ffffff', grid: '#e9edf2', dim: '#94a3b8', fault: 'rgba(224, 49, 49, 0.12)', faultLine: '#e03131' }
      g.fillStyle = c.bg
      g.fillRect(0, 0, w, h)
      const L = 52
      const R = 12
      const T = 10
      const B = 22
      const pw = Math.max(1, w - L - R)
      const ph = Math.max(1, h - T - B)
      g.font = '10px system-ui, sans-serif'
      if (x.length < 2 || series.length === 0) {
        g.fillStyle = c.dim
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.font = '12px system-ui, sans-serif'
        g.fillText(placeholder, w / 2, h / 2)
        return
      }
      const x0 = x[0]
      const x1 = x[x.length - 1] > x0 ? x[x.length - 1] : x0 + 1
      const xp = (v: number) => L + ((v - x0) / (x1 - x0)) * pw
      const range = (ys: (number | null)[]) => {
        let lo = Infinity
        let hi = -Infinity
        for (const v of ys) if (v !== null && Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v))
        if (!Number.isFinite(lo)) return [0, 1]
        if (hi - lo < 1e-9) return [lo - 1, hi + 1]
        const pad = (hi - lo) * 0.06
        return [lo - pad, hi + pad]
      }
      const all = range(series.flatMap((s) => s.y))
      const ranges = series.map((s) => (separateY ? range(s.y) : all))

      // Fault windows.
      for (const win of windows) {
        const a = xp(Math.max(x0, win.from))
        const b = xp(Math.min(x1, win.to ?? x1))
        if (b <= a) continue
        g.fillStyle = c.fault
        g.fillRect(a, T, Math.max(1, b - a), ph)
        g.strokeStyle = c.faultLine
        g.globalAlpha = 0.6
        g.beginPath()
        g.moveTo(a + 0.5, T)
        g.lineTo(a + 0.5, T + ph)
        g.stroke()
        g.globalAlpha = 1
        if (win.label) {
          g.fillStyle = c.faultLine
          g.textAlign = 'left'
          g.textBaseline = 'top'
          g.fillText(win.label, a + 3, T + 2)
        }
      }

      // Grid and the first series' y labels.
      const [ylo, yhi] = ranges[0]
      g.textAlign = 'right'
      g.textBaseline = 'middle'
      for (const f of [0, 0.5, 1]) {
        const y = T + (1 - f) * ph
        g.strokeStyle = c.grid
        g.beginPath()
        g.moveTo(L, y)
        g.lineTo(L + pw, y)
        g.stroke()
        g.fillStyle = separateY && series.length > 1 ? seriesColor(0, dark) : c.dim
        g.fillText(fmt(ylo + f * (yhi - ylo)), L - 6, y)
      }
      g.textBaseline = 'top'
      for (let k = 0; k <= 4; k++) {
        const v = x0 + (k / 4) * (x1 - x0)
        const px = L + (k / 4) * pw
        g.strokeStyle = c.grid
        g.beginPath()
        g.moveTo(px, T)
        g.lineTo(px, T + ph)
        g.stroke()
        g.fillStyle = c.dim
        g.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center'
        g.fillText(`${fmt(v)}${xUnit ? ` ${xUnit}` : ''}`, px, T + ph + 5)
      }

      // Traces.
      series.forEach((s, i) => {
        const [lo, hi] = ranges[i]
        const yp = (v: number) => T + (1 - (v - lo) / (hi - lo)) * ph
        g.strokeStyle = seriesColor(i, dark)
        g.lineWidth = 1.5
        g.lineJoin = 'round'
        g.beginPath()
        let pen = false
        for (let k = 0; k < x.length && k < s.y.length; k++) {
          const v = s.y[k]
          if (v === null || !Number.isFinite(v)) {
            pen = false
            continue
          }
          if (pen) g.lineTo(xp(x[k]), yp(v))
          else g.moveTo(xp(x[k]), yp(v))
          pen = true
        }
        g.stroke()
      })
      if (marker && Number.isFinite(marker.y)) {
        const [lo, hi] = ranges[0]
        g.fillStyle = seriesColor(0, dark)
        g.beginPath()
        g.arc(xp(marker.x), T + (1 - (marker.y - lo) / (hi - lo)) * ph, 4, 0, Math.PI * 2)
        g.fill()
      }
    }
    draw()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => (frame ||= requestAnimationFrame(draw))) : null
    ro?.observe(cv)
    return () => {
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [x, series, windows, marker, xUnit, height, placeholder, separateY, dark])

  return (
    <Box>
      <canvas ref={ref} role="img" aria-label={ariaLabel ?? 'chart'} style={{ width: '100%', height, display: 'block', borderRadius: 4 }} />
    </Box>
  )
}
