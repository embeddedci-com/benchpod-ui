import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react'
import { Box, Button, Group, Stack, useMantineColorScheme } from '@mantine/core'

/** One run-length LA edge: from sample `i` on, all 14 channels read `w` (bit n = LA(n+1)). */
export type LaEdge = { i: number; w: number }

// The capture surface of the EmbeddedCI web app's Capture tab, shared with the desktop app: an
// ADC lane, LA lanes and an optional DAC track on one time axis, drag to zoom, decode chips.

// Per-channel trace colours (distinct, readable on both light and dark backgrounds),
// so LA lanes and the decode hints read like a real logic analyzer.
const LA_PALETTE = [
  '#2f9e44', '#1c7ed6', '#f08c00', '#ae3ec9',
  '#e64980', '#0ca678', '#4263eb', '#fa5252',
  '#7048e8', '#12b886', '#e8590c', '#1098ad',
]

export type CanvasColors = {
  bg: string
  panel: string
  grid: string
  axisMid: string
  adc: string
  dac: string
  label: string
  dim: string
  dragOverlay: string
  crosshair: string
}

// ---- Canvas geometry (CSS px) ---------------------------------------------------
const PAD_L = 62 // left gutter: voltage ticks + lane labels
const PAD_R = 16
const PAD_T = 12
const TIME_AXIS_H = 22 // bottom strip for time-axis labels
const ADC_LANE_H = 176 // the analog lane is the tall one so voltages are readable
const DAC_LANE_H = 96 // the DAC output track (shorter than ADC) sits above the ADC/LA lanes
const LANE_GAP = 12 // gap between the ADC lane and the first LA lane
const LA_ROW_H = 40 // taller rows so the logic-1 (top) and logic-0 (bottom) rails are clearly separated
// Vertical inset of the logic-1 / logic-0 rails inside each LA row. A generous gap
// between them makes the level of each trace unambiguous at a glance.
const LA_HI_INSET = 9 // logic-1 rail: rowTop + LA_HI_INSET
const LA_LO_INSET = 9 // logic-0 rail: rowTop + LA_ROW_H - LA_LO_INSET

function formatTimeLabel(tS: number): string {
  const us = tS * 1e6
  if (Math.abs(us) < 1000) return `${us.toFixed(1)} µs`
  const ms = tS * 1e3
  if (Math.abs(ms) < 10) return `${ms.toFixed(3)} ms`
  return `${ms.toFixed(2)} ms`
}

// A decoded value drawn on the waveform: a labelled chip on LA channel `ch`
// (1-based) spanning [startUs, endUs].  Built from a decode result when the
// overlay toggle is on, so the digital edges and the decoded bytes line up.
export type LaneAnnotation = { ch: number; startUs: number; endUs: number; label: string; color: string }

// The DAC output driving DURING this capture, drawn as a track above the ADC/LA lanes on the SAME
// time axis so you can see the replayed DAC and how the target reacts to it. `volts` (when known) is
// one playthrough of the output; `playthroughUs` is how long that array spans (0 = a held level,
// drawn flat). `repeat` tiles it across the window; `stopUs` (>0) is where the pod cuts the DAC —
// past it the track is idle. `volts` null ⇒ we only know the timing, so just the active band + name.
export type DacTrack = {
  label: string
  /** What `volts` holds: volts, or mA for the 4-20 mA output. */
  unit: 'V' | 'mA'
  volts: number[] | null
  playthroughUs: number
  repeat: boolean
  stopUs: number
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

type Viewport = { tStart: number; tEnd: number }

function plotLayout(width: number) {
  const gl = PAD_L
  const gr = width - PAD_R
  return { gl, gr, plotWidth: Math.max(1, gr - gl) }
}

function clampViewport(full: Viewport, manual: Viewport | null): Viewport {
  if (!manual) return full
  const span = full.tEnd - full.tStart || 1e-15
  let lo = Math.min(manual.tStart, manual.tEnd)
  let hi = Math.max(manual.tStart, manual.tEnd)
  lo = Math.max(full.tStart, lo)
  hi = Math.min(full.tEnd, hi)
  const minSpan = Math.max(1e-15, span * 0.001)
  if (hi - lo < minSpan) return full
  return { tStart: lo, tEnd: hi }
}

/**
 * The unified capture surface: ADC voltage lane (autoscaled, gridded) over the
 * selected LA digital lanes, on one shared time viewport.  Drag to zoom a region,
 * double-click to reset, pinch on touch; hover shows a crosshair + time/voltage
 * readout and each lane's bit value.  All lanes share the horizontal (time) axis.
 */
export function CaptureCanvas({
  laEdges,
  laSampleCount,
  laRateHz,
  adcVolts,
  adcRateHz,
  adcUnit = 'V',
  visibleLa,
  laNames = [],
  showAdc,
  colors,
  zoomSessionKey,
  annotations = [],
  dacTrack = null,
}: {
  laEdges: LaEdge[]
  laSampleCount: number
  laRateHz: number | null
  /** The analog samples, in `adcUnit`: volts, or mA for a capture of the 4-20 mA input. */
  adcVolts: number[]
  adcRateHz: number | null
  adcUnit?: 'V' | 'mA'
  visibleLa: number[]
  /** Wiring-profile name per channel (index ch-1, '' when unassigned), drawn under the lane's LA label. */
  laNames?: string[]
  showAdc: boolean
  colors: CanvasColors
  zoomSessionKey: string
  annotations?: LaneAnnotation[]
  dacTrack?: DacTrack | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<Viewport>({ tStart: 0, tEnd: 1 })
  const fullRef = useRef<Viewport>({ tStart: 0, tEnd: 1 })
  const [manualViewport, setManualViewport] = useState<Viewport | null>(null)
  const [drag, setDrag] = useState<{ startX: number; currentX: number } | null>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)

  const laCount = visibleLa.length
  const adcLaneH = showAdc ? ADC_LANE_H : 0
  const dacLaneH = dacTrack ? DAC_LANE_H : 0
  // Lanes stack top→bottom: DAC track, then the ADC analog lane, then the LA digital rows. Each gap
  // is only inserted when both the lane above and something below it are present.
  const dacGap = dacLaneH && (showAdc || laCount) ? LANE_GAP : 0
  const adcGap = showAdc && laCount ? LANE_GAP : 0
  const cssHeight =
    PAD_T + dacLaneH + dacGap + adcLaneH + adcGap + laCount * LA_ROW_H + TIME_AXIS_H

  const hasData =
    (showAdc && adcVolts.length > 0) || (laCount > 0 && laSampleCount > 0) || !!dacTrack

  // Reset the zoom whenever a new capture arrives.
  useEffect(() => {
    setManualViewport(null)
    setDrag(null)
    setHoverX(null)
  }, [zoomSessionKey])

  const fullTimeRange = useCallback((): Viewport => {
    const laDur = laRateHz && laSampleCount > 1 ? (laSampleCount - 1) / laRateHz : 0
    const adcDur = showAdc && adcRateHz && adcVolts.length > 1 ? (adcVolts.length - 1) / adcRateHz : 0
    const end = Math.max(laDur, adcDur)
    return { tStart: 0, tEnd: end > 0 ? end : 1 }
  }, [laRateHz, laSampleCount, showAdc, adcRateHz, adcVolts.length])

  const finalizeDrag = useCallback((startX: number, currentX: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const vp = viewportRef.current
    const full = fullRef.current
    const rect = canvas.getBoundingClientRect()
    const { gl, gr, plotWidth } = plotLayout(rect.width)
    const x0 = Math.max(gl, Math.min(gr, Math.min(startX, currentX)))
    const x1 = Math.max(gl, Math.min(gr, Math.max(startX, currentX)))
    if (x1 - x0 < 6) return
    const dur = vp.tEnd - vp.tStart || 1e-15
    const tA = vp.tStart + ((x0 - gl) / plotWidth) * dur
    const tB = vp.tStart + ((x1 - gl) / plotWidth) * dur
    const fullSpan = full.tEnd - full.tStart || 1e-15
    const minSpan = Math.max(1e-15, fullSpan * 0.001)
    if (tB - tA < minSpan) return
    setManualViewport({ tStart: Math.max(full.tStart, tA), tEnd: Math.min(full.tEnd, tB) })
  }, [])

  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas || !hasData) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      setDrag({ startX: x, currentX: x })
    },
    [hasData]
  )

  const handleMouseMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    setHoverX(x)
    setDrag((d) => (d ? { ...d, currentX: x } : d))
  }, [])

  const handleMouseUp = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      setDrag((d) => {
        if (!d) return d
        const rect = canvasRef.current?.getBoundingClientRect()
        finalizeDrag(d.startX, rect ? e.clientX - rect.left : d.currentX)
        return null
      })
    },
    [finalizeDrag]
  )

  const handleMouseLeave = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      setHoverX(null)
      setDrag((d) => {
        if (!d) return d
        const rect = canvasRef.current?.getBoundingClientRect()
        finalizeDrag(d.startX, rect ? e.clientX - rect.left : d.currentX)
        return null
      })
    },
    [finalizeDrag]
  )

  const handleDoubleClick = useCallback(() => {
    setDrag(null)
    setManualViewport(null)
  }, [])

  // Two-finger pinch zoom, anchored at the pinch centre (mirrors the scope tab).
  const pinchRef = useRef<{ startDist: number; centerX: number; startVp: Viewport } | null>(null)
  const touchDist = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

  const handleTouchStart = useCallback(
    (e: TouchEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      if (e.touches.length >= 2) {
        setDrag(null)
        setHoverX(null)
        pinchRef.current = {
          startDist: touchDist(e.touches[0], e.touches[1]),
          centerX: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
          startVp: { ...viewportRef.current },
        }
        return
      }
      if (!hasData) return
      const x = e.touches[0].clientX - rect.left
      setDrag({ startX: x, currentX: x })
    },
    [hasData]
  )

  const handleTouchMove = useCallback((e: TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const p = pinchRef.current
    if (e.touches.length >= 2 && p) {
      const dist = touchDist(e.touches[0], e.touches[1])
      const { gl, plotWidth } = plotLayout(rect.width)
      const full = fullRef.current
      const startSpan = p.startVp.tEnd - p.startVp.tStart || 1e-15
      const fullSpan = full.tEnd - full.tStart || 1e-15
      const minSpan = Math.max(1e-15, fullSpan * 0.001)
      const scale = p.startDist / Math.max(1, dist)
      const newSpan = Math.min(fullSpan, Math.max(minSpan, startSpan * scale))
      const frac = Math.max(0, Math.min(1, (p.centerX - gl) / plotWidth))
      const centerT = p.startVp.tStart + frac * startSpan
      let newStart = centerT - frac * newSpan
      let newEnd = newStart + newSpan
      if (newStart < full.tStart) {
        newStart = full.tStart
        newEnd = newStart + newSpan
      }
      if (newEnd > full.tEnd) {
        newEnd = full.tEnd
        newStart = newEnd - newSpan
      }
      setManualViewport({ tStart: Math.max(full.tStart, newStart), tEnd: Math.min(full.tEnd, newEnd) })
      return
    }
    const x = e.touches[0].clientX - rect.left
    setDrag((d) => (d ? { ...d, currentX: x } : d))
  }, [])

  const handleTouchEnd = useCallback(
    (e: TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length < 2) pinchRef.current = null
      if (e.touches.length === 0) {
        setDrag((d) => {
          if (d) finalizeDrag(d.startX, d.currentX)
          return null
        })
      }
    },
    [finalizeDrag]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = 0
    const render = () => {
      frame = 0
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const pw = Math.max(1, Math.floor(rect.width * dpr))
      const ph = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.scale(dpr, dpr)
      const w = rect.width
      const h = rect.height
      const { gl, gr, plotWidth } = plotLayout(w)
      const gt = PAD_T
      const gb = h - TIME_AXIS_H

      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, w, h)

      const full = fullTimeRange()
      const vp = clampViewport(full, manualViewport)
      viewportRef.current = vp
      fullRef.current = full
      const tDur = vp.tEnd - vp.tStart || 1e-15
      const xForT = (t: number) => gl + ((t - vp.tStart) / tDur) * plotWidth

      // Vertical time gridlines (10 divisions) behind everything.
      ctx.strokeStyle = colors.grid
      ctx.lineWidth = 1
      ctx.setLineDash([])
      const xDivs = 10
      for (let i = 0; i <= xDivs; i += 1) {
        const x = gl + (plotWidth * i) / xDivs
        ctx.beginPath()
        ctx.moveTo(x, gt)
        ctx.lineTo(x, gb)
        ctx.stroke()
      }

      if (!hasData) {
        ctx.fillStyle = colors.dim
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Waiting for capture: press Capture', (gl + gr) / 2, (gt + gb) / 2)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.restore()
        return
      }

      // ---- DAC output track ----------------------------------------------------
      // The output driving during the capture, on the SAME time axis, so you can read the replayed
      // DAC against the LA/ADC lanes. Sampled per-pixel so looping + zoom Just Work.
      if (dacTrack) {
        const dacTop = gt
        const dacBot = gt + dacLaneH
        const innerT = dacTop + 8
        const innerB = dacBot - 6
        const stopSec = dacTrack.stopUs > 0 ? dacTrack.stopUs / 1e6 : null
        const playSec = dacTrack.playthroughUs > 0 ? dacTrack.playthroughUs / 1e6 : 0
        const volts = dacTrack.volts
        // When the DAC FREEZES and holds its last output: at the armed cut, else after one
        // playthrough for a non-repeating one-shot, else never (a repeating waveform runs the whole
        // window).  After this the pod's DAC latches its last value and holds it — it does NOT drop
        // to 0 V — so the track draws a flat line at the held level, not empty space.
        const holdStart = stopSec != null ? stopSec : !dacTrack.repeat && playSec > 0 ? playSec : null

        // Shade the "playing" region (before the freeze) so the freeze point stands out; the held
        // flat line continues past it, unshaded.
        const xa = Math.max(gl, xForT(0))
        const xb = Math.min(gr, xForT(holdStart != null ? holdStart : vp.tEnd))
        if (xb > xa) {
          ctx.fillStyle = colors.dac
          ctx.globalAlpha = 0.07
          ctx.fillRect(xa, dacTop, xb - xa, dacBot - dacTop)
          ctx.globalAlpha = 1
        }

        if (volts && volts.length > 0) {
          let vmin = Infinity
          let vmax = -Infinity
          for (const v of volts) {
            if (Number.isFinite(v)) {
              if (v < vmin) vmin = v
              if (v > vmax) vmax = v
            }
          }
          if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) {
            vmin = 0
            vmax = 1
          }
          const pad = (vmax - vmin) * 0.12 || 0.1
          vmin -= pad
          vmax += pad
          if (vmin === vmax) {
            vmin -= 0.5
            vmax += 0.5
          }
          const vSpan = vmax - vmin || 1
          const yForV = (v: number) => innerB - ((v - vmin) / vSpan) * (innerB - innerT)

          // The value latched at the freeze (the last sample played before holdStart).
          let heldVolt = volts[0]
          if (holdStart != null) {
            if (playSec <= 0) heldVolt = volts[0]
            else {
              const frac = holdStart / playSec - Math.floor(holdStart / playSec)
              // an exact playthrough boundary (freeze at waveform end) latches the final sample.
              const hidx = frac === 0 ? volts.length - 1 : Math.min(volts.length - 1, Math.floor(frac * volts.length))
              heldVolt = volts[hidx]
            }
          }
          // The DAC output at time t: the tiled waveform until the freeze, then the held level.
          const voltAtT = (t: number): number => {
            if (holdStart != null && t >= holdStart) return heldVolt
            if (playSec <= 0) return volts[0]
            let ph = t / playSec
            ph -= Math.floor(ph)
            return volts[Math.min(volts.length - 1, Math.floor(ph * volts.length))]
          }

          ctx.save()
          ctx.beginPath()
          ctx.rect(gl, dacTop, plotWidth, dacBot - dacTop)
          ctx.clip()
          ctx.strokeStyle = colors.dac
          ctx.lineWidth = 1.5
          ctx.beginPath()
          let started = false
          for (let px = Math.round(gl); px <= Math.round(gr); px += 1) {
            const t = vp.tStart + ((px - gl) / plotWidth) * tDur
            if (t < 0) continue
            const y = yForV(voltAtT(t))
            if (!started) {
              ctx.moveTo(px, y)
              started = true
            } else {
              ctx.lineTo(px, y)
            }
          }
          ctx.stroke()
          ctx.restore()

          // Min/max volt labels in the gutter so the DAC amplitude is readable.
          ctx.font = '11px ui-monospace, monospace'
          ctx.textAlign = 'right'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = colors.label
          ctx.fillText(`${vmax.toFixed(2)} ${dacTrack.unit}`, gl - 6, innerT + 2)
          ctx.fillText(`${vmin.toFixed(2)} ${dacTrack.unit}`, gl - 6, innerB - 2)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
        } else {
          // No sample preview available (e.g. a faulted waveform) — just note it's driving.
          ctx.fillStyle = colors.dim
          ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('DAC driving', (gl + gr) / 2, (dacTop + dacBot) / 2)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
        }

        // "DAC freezes here" marker (dashed) where the output latches its last value — a timed cut
        // or the end of one playthrough. A small "hold" tag makes it clear the level is held, not 0.
        if (holdStart != null && holdStart >= vp.tStart && holdStart <= vp.tEnd) {
          const xs = xForT(holdStart)
          ctx.strokeStyle = colors.dac
          ctx.setLineDash([4, 3])
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(xs, dacTop)
          ctx.lineTo(xs, dacBot)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.font = '600 9px ui-monospace, monospace'
          ctx.fillStyle = colors.dac
          ctx.textBaseline = 'top'
          ctx.textAlign = xs > gr - 34 ? 'right' : 'left'
          ctx.fillText('hold', xs > gr - 34 ? xs - 3 : xs + 3, dacTop + 3)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
        }

        // Lane separator.
        ctx.strokeStyle = colors.grid
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(gl, dacBot)
        ctx.lineTo(gr, dacBot)
        ctx.stroke()

        // Lane label = the waveform NAME (so the "Start DAC with capture" selector doesn't have to).
        ctx.font = '600 12px ui-monospace, monospace'
        const tag = `DAC · ${dacTrack.label}`
        const tagW = ctx.measureText(tag).width
        ctx.fillStyle = colors.panel
        ctx.globalAlpha = 0.82
        ctx.fillRect(gl + 4, dacTop + 4, tagW + 8, 16)
        ctx.globalAlpha = 1
        ctx.fillStyle = colors.dac
        ctx.textBaseline = 'middle'
        ctx.fillText(tag, gl + 8, dacTop + 12)
        ctx.textBaseline = 'alphabetic'
      }

      // ---- ADC analog lane -----------------------------------------------------
      const adcTop = gt + dacLaneH + dacGap
      const adcBot = adcTop + adcLaneH
      if (showAdc) {
        const n = adcVolts.length
        // Autoscale to the samples currently in view.
        let vmin = Infinity
        let vmax = -Infinity
        if (adcRateHz && n > 0) {
          for (let i = 0; i < n; i += 1) {
            const t = i / adcRateHz
            if (t < vp.tStart || t > vp.tEnd) continue
            const v = adcVolts[i]
            if (Number.isFinite(v)) {
              vmin = Math.min(vmin, v)
              vmax = Math.max(vmax, v)
            }
          }
        }
        if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) {
          for (const v of adcVolts) {
            if (Number.isFinite(v)) {
              vmin = Math.min(vmin, v)
              vmax = Math.max(vmax, v)
            }
          }
        }
        if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) {
          vmin = 0
          vmax = 1
        }
        const pad = (vmax - vmin) * 0.1 || 0.5
        vmin -= pad
        vmax += pad
        if (vmin === vmax) {
          vmin -= 0.5
          vmax += 0.5
        }
        const innerT = adcTop + 6
        const innerB = adcBot - 6
        const vSpan = vmax - vmin || 1
        const yForV = (v: number) => innerB - ((v - vmin) / vSpan) * (innerB - innerT)

        // Horizontal voltage gridlines + gutter labels at "nice" volt steps.
        const rawStep = vSpan / 5
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
        const norm = rawStep / mag
        const niceStep = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        const vStart = Math.ceil(vmin / niceStep) * niceStep
        for (let v = vStart; v <= vmax; v += niceStep) {
          const y = yForV(v)
          if (y < adcTop || y > adcBot) continue
          ctx.strokeStyle = Math.abs(v) < niceStep / 2 ? colors.axisMid : colors.grid
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(gl, y)
          ctx.lineTo(gr, y)
          ctx.stroke()
          ctx.fillStyle = colors.label
          ctx.fillText(`${niceStep < 1 ? v.toFixed(2) : v.toFixed(1)} ${adcUnit}`, gl - 6, y)
        }
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'

        // Analog trace (clipped to the plot area so it never bleeds into the gutter).
        if (adcRateHz && n > 0) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(gl, adcTop, plotWidth, adcBot - adcTop)
          ctx.clip()
          ctx.strokeStyle = colors.adc
          ctx.lineWidth = 1.5
          ctx.beginPath()
          let started = false
          for (let i = 0; i < n; i += 1) {
            const x = xForT(i / adcRateHz)
            const y = yForV(adcVolts[i])
            if (!started) {
              ctx.moveTo(x, y)
              started = true
            } else {
              ctx.lineTo(x, y)
            }
          }
          ctx.stroke()
          ctx.restore()
        }

        // Lane separator.
        ctx.strokeStyle = colors.grid
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(gl, adcBot)
        ctx.lineTo(gr, adcBot)
        ctx.stroke()

        // Lane label — a small tag INSIDE the plot area (top-left), since the left
        // gutter is taken by the voltage tick labels.  A translucent backing keeps
        // it legible over the trace/gridlines.
        ctx.font = '600 12px ui-monospace, monospace'
        const tag = adcUnit === 'mA' ? '4-20 mA input' : 'ADC'
        const tagW = ctx.measureText(tag).width
        ctx.fillStyle = colors.panel
        ctx.globalAlpha = 0.82
        ctx.fillRect(gl + 4, adcTop + 4, tagW + 8, 16)
        ctx.globalAlpha = 1
        ctx.fillStyle = colors.adc
        ctx.textBaseline = 'middle'
        ctx.fillText(tag, gl + 8, adcTop + 12)
        ctx.textBaseline = 'alphabetic'
      }

      // ---- LA digital lanes ----------------------------------------------------
      const laTop0 = adcBot + adcGap

      // Faint high/low reference rails per lane (a horizontal grid), so a channel
      // that's always 0 or always 1 visibly sits on the bottom or top rail rather
      // than floating as an ambiguous single line.  The low rail is the logic-0
      // floor (drawn a touch stronger); the high rail marks logic-1.
      for (let k = 0; k < laCount; k += 1) {
        const rowTop = laTop0 + k * LA_ROW_H
        const yHi = rowTop + LA_HI_INSET
        const yLo = rowTop + LA_ROW_H - LA_LO_INSET
        ctx.lineWidth = 1
        ctx.strokeStyle = colors.grid
        ctx.beginPath()
        ctx.moveTo(gl, yHi)
        ctx.lineTo(gr, yHi)
        ctx.stroke()
        ctx.strokeStyle = colors.axisMid
        ctx.beginPath()
        ctx.moveTo(gl, yLo)
        ctx.lineTo(gr, yLo)
        ctx.stroke()
      }

      ctx.save()
      ctx.beginPath()
      ctx.rect(gl, laTop0, plotWidth, laCount * LA_ROW_H)
      ctx.clip()
      for (let k = 0; k < laCount; k += 1) {
        const ch = visibleLa[k] // 1-based
        const bit = ch - 1
        const rowTop = laTop0 + k * LA_ROW_H
        const yHi = rowTop + LA_HI_INSET
        const yLo = rowTop + LA_ROW_H - LA_LO_INSET
        const color = LA_PALETTE[bit % LA_PALETTE.length]
        if (laRateHz && laSampleCount > 0 && laEdges.length > 0) {
          // Draw straight from the run-length edges — O(edges), not O(samples). For this
          // channel, only the word-edges where its bit actually flips produce a vertical.
          ctx.strokeStyle = color
          ctx.lineWidth = 1.6
          ctx.beginPath()
          let prevY = ((laEdges[0].w >> bit) & 1) ? yHi : yLo
          ctx.moveTo(xForT(laEdges[0].i / laRateHz), prevY)
          for (let e = 1; e < laEdges.length; e += 1) {
            const y = ((laEdges[e].w >> bit) & 1) ? yHi : yLo
            if (y === prevY) continue // this word-edge didn't change THIS channel
            const x = xForT(laEdges[e].i / laRateHz)
            ctx.lineTo(x, prevY) // hold the level up to the transition…
            ctx.lineTo(x, y) // …then flip
            prevY = y
          }
          ctx.lineTo(xForT((laSampleCount - 1) / laRateHz), prevY) // hold to the end
          ctx.stroke()
        }
      }
      ctx.restore()
      // Lane labels in the gutter (outside the clip), plus tiny 1/0 level markers
      // at the high/low rails so it is unambiguous which level a trace sits on.
      for (let k = 0; k < laCount; k += 1) {
        const ch = visibleLa[k]
        const rowTop = laTop0 + k * LA_ROW_H
        const yHi = rowTop + LA_HI_INSET
        const yLo = rowTop + LA_ROW_H - LA_LO_INSET
        ctx.fillStyle = LA_PALETTE[(ch - 1) % LA_PALETTE.length]
        ctx.font = '600 12px ui-monospace, monospace'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        // With a wiring-profile name for the channel, stack it under the LA number, truncated to the gutter.
        const laName = laNames[ch - 1]
        if (laName) {
          ctx.fillText(`LA${ch}`, 8, rowTop + LA_ROW_H / 2 - 6)
          ctx.font = '600 9px ui-monospace, monospace'
          const maxW = gl - 22
          let shown = laName
          if (ctx.measureText(laName).width > maxW) {
            while (shown.length > 1 && ctx.measureText(`${shown}…`).width > maxW) shown = shown.slice(0, -1)
            shown = `${shown}…`
          }
          ctx.fillText(shown, 8, rowTop + LA_ROW_H / 2 + 8)
        } else {
          ctx.fillText(`LA${ch}`, 8, rowTop + LA_ROW_H / 2)
        }
        // 1 (top) / 0 (bottom) rail hints, dimmed and right-aligned against the plot edge.
        ctx.font = '600 9px ui-monospace, monospace'
        ctx.fillStyle = colors.dim
        ctx.textAlign = 'right'
        ctx.fillText('1', gl - 5, yHi)
        ctx.fillText('0', gl - 5, yLo)
        ctx.textAlign = 'left'
      }
      ctx.textBaseline = 'alphabetic'

      // ---- Decode overlay: value chips on the decoded lanes -------------------
      if (annotations.length && laCount) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(gl, laTop0, plotWidth, laCount * LA_ROW_H)
        ctx.clip()
        ctx.font = '600 11px ui-monospace, monospace'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        for (const a of annotations) {
          const rowK = visibleLa.indexOf(a.ch)
          if (rowK < 0) continue
          const rowTop = laTop0 + rowK * LA_ROW_H
          const x0 = xForT(a.startUs / 1e6)
          const x1 = xForT(a.endUs / 1e6)
          if (x1 < gl || x0 > gr) continue // fully off-screen
          const bx = Math.max(gl, x0)
          const bw = Math.max(3, Math.min(gr, x1) - bx)
          roundRectPath(ctx, bx, rowTop + 3, bw, LA_ROW_H - 6, 3)
          ctx.fillStyle = colors.panel
          ctx.globalAlpha = 0.92
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.strokeStyle = a.color
          ctx.lineWidth = 1
          ctx.stroke()
          if (bw > ctx.measureText(a.label).width + 6) {
            ctx.fillStyle = a.color
            ctx.fillText(a.label, bx + bw / 2, rowTop + LA_ROW_H / 2)
          }
        }
        ctx.restore()
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      }

      // ---- Drag-to-zoom overlay -----------------------------------------------
      if (drag) {
        const x0 = Math.min(drag.startX, drag.currentX)
        const x1 = Math.max(drag.startX, drag.currentX)
        ctx.fillStyle = colors.dragOverlay
        ctx.fillRect(x0, gt, Math.max(0, x1 - x0), gb - gt)
      }

      // ---- Time axis labels ----------------------------------------------------
      ctx.fillStyle = colors.label
      ctx.font = '11px ui-monospace, monospace'
      // A label every second division, or every fifth when they would run into each other.
      const labelStep = ((plotWidth / xDivs) * 2 >= 90) ? 2 : 5
      for (let i = 0; i <= xDivs; i += labelStep) {
        const frac = i / xDivs
        const label = formatTimeLabel(vp.tStart + frac * tDur)
        const lw = ctx.measureText(label).width
        let lx = gl + frac * plotWidth - lw / 2
        if (i === 0) lx = gl
        else if (i === xDivs) lx = gr - lw
        ctx.fillText(label, lx, h - 7)
      }

      // ---- Hover crosshair + readout ------------------------------------------
      if (hoverX != null && !drag) {
        const hx = Math.max(gl, Math.min(gr, hoverX))
        const tHover = vp.tStart + ((hx - gl) / plotWidth) * tDur
        ctx.strokeStyle = colors.crosshair
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(hx, gt)
        ctx.lineTo(hx, gb)
        ctx.stroke()
        ctx.setLineDash([])

        let readout = formatTimeLabel(tHover)
        if (showAdc && adcRateHz && adcVolts.length > 0) {
          const idx = Math.max(0, Math.min(adcVolts.length - 1, Math.round(tHover * adcRateHz)))
          const v = adcVolts[idx]
          if (Number.isFinite(v)) readout += `   ${v.toFixed(3)} ${adcUnit}`
        }
        ctx.font = '11px ui-monospace, monospace'
        const boxW = ctx.measureText(readout).width + 12
        const boxH = 20
        let bx = hx + 8
        if (bx + boxW > gr) bx = hx - 8 - boxW
        bx = Math.max(gl, Math.min(bx, gr - boxW))
        ctx.fillStyle = colors.panel
        ctx.globalAlpha = 0.95
        ctx.fillRect(bx, gt + 2, boxW, boxH)
        ctx.globalAlpha = 1
        ctx.strokeStyle = colors.grid
        ctx.lineWidth = 1
        ctx.strokeRect(bx, gt + 2, boxW, boxH)
        ctx.fillStyle = colors.label
        ctx.textBaseline = 'middle'
        ctx.fillText(readout, bx + 6, gt + 2 + boxH / 2)
        ctx.textBaseline = 'alphabetic'
      }

      ctx.textAlign = 'left'
      ctx.restore()
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(render)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(canvas)
    schedule()
    return () => {
      ro.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [
    laEdges,
    laSampleCount,
    laRateHz,
    adcVolts,
    adcRateHz,
    visibleLa,
    laNames,
    showAdc,
    colors,
    annotations,
    drag,
    manualViewport,
    hoverX,
    hasData,
    adcLaneH,
    dacLaneH,
    dacGap,
    adcGap,
    dacTrack,
    laCount,
    fullTimeRange,
    adcUnit,
  ])

  return (
    <Stack gap={6}>
      <Box
        style={{
          background: colors.bg,
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            showAdc
              ? 'Capture: ADC and logic-analyzer traces on a shared timebase. Drag to zoom, double-click to reset.'
              : 'Capture: logic-analyzer traces. Drag to zoom, double-click to reset.'
          }
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ display: 'block', width: '100%', height: cssHeight, cursor: 'crosshair', touchAction: 'none' }}
        />
      </Box>
      {manualViewport ? (
        <Group justify="flex-end">
          <Button size="xs" variant="light" onClick={() => setManualViewport(null)}>
            Reset zoom
          </Button>
        </Group>
      ) : null}
    </Stack>
  )
}

/** The canvas palette for the current light or dark color scheme. */
export function useCanvasColors(): CanvasColors {
  const { colorScheme } = useMantineColorScheme()
  return useMemo<CanvasColors>(() => {
    if (colorScheme === 'dark') {
      return {
        bg: '#0f1218',
        panel: '#0f1218',
        grid: '#242c3a',
        axisMid: '#5c6578',
        adc: '#f59e0b',
        dac: '#38bdf8',
        label: '#cbd5e1',
        dim: '#8892a4',
        dragOverlay: 'rgba(96, 165, 250, 0.16)',
        crosshair: '#64748b',
      }
    }
    return {
      bg: '#ffffff',
      panel: '#ffffff',
      grid: '#e9edf2',
      axisMid: '#94a3b8',
      adc: '#e8590c',
      dac: '#0ca5e9',
      label: '#475569',
      dim: '#94a3b8',
      dragOverlay: 'rgba(59, 130, 246, 0.14)',
      crosshair: '#94a3b8',
    }
  }, [colorScheme])
}
