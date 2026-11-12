import { useEffect, useMemo, useRef, useState } from 'react'
import { convertSource, type Converted } from '../convert'
import { engineErrorText, loadEngine, type Engine, type StimulusValidateResult, type ValidateResult } from '../engine'
import type { PodSensorStatus, SensorPod } from '../pod'
import { lineOfPath } from '../yaml'

/** The engine, once loaded (null while loading); `error` when it cannot load. */
export function useEngine(): { engine: Engine | null; error: string | null } {
  const [engine, setEngine] = useState<Engine | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadEngine().then(
      (e) => live && setEngine(e),
      (e: Error) => live && setError(`The sensor engine did not load: ${e.message}`),
    )
    return () => {
      live = false
    }
  }, [])
  return { engine, error }
}

/** One check of a source: converted to JSON, then compiled. */
export type Analysis = {
  converted: Converted | null
  /** The engine's answer (sensor or stimulus), null until it ran. */
  result: ValidateResult | StimulusValidateResult | null
  /** The first problem, as text, and its line in the source. */
  error: string | null
  errorLine: number | null
}

/** Debounced conversion and validation of `source` as the user types. */
export function useAnalysis(source: string, engine: Engine | null, delayMs = 200): Analysis {
  const [text, setText] = useState(source)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      setText(source)
      return
    }
    const t = setTimeout(() => setText(source), delayMs)
    return () => clearTimeout(t)
  }, [source, delayMs])
  return useMemo(() => analyze(text, engine), [text, engine])
}

export function analyze(text: string, engine: Engine | null): Analysis {
  const c = convertSource(text)
  if (!c.ok) return { converted: null, result: null, error: c.error, errorLine: c.line }
  if (!engine) return { converted: c, result: null, error: null, errorLine: null }
  const result = c.doc.kind === 'stimulus' ? engine.stimulusValidate(c.json) : engine.validate(c.json)
  if (result.ok) return { converted: c, result, error: null, errorLine: null }
  return { converted: c, result, error: engineErrorText(result), errorLine: lineOfPath(c.locs, result.path) }
}

/**
 * The pod's sensor_status: read on mount and after `refresh`, polled while anything runs (an
 * instance or a stimulus), so an idle page sends nothing.
 */
export function usePodStatus(pod: SensorPod | null, enabled: boolean, intervalMs = 1500) {
  const [status, setStatus] = useState<PodSensorStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const busy = !!status && (status.instances.some((i) => i.running) || !!status.stimulus?.running)
  useEffect(() => {
    if (!pod || !enabled) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const s = await pod.status()
        if (!live) return
        setStatus(s)
        setError(null)
        if (s.instances.some((i) => i.running) || s.stimulus?.running) timer = setTimeout(read, intervalMs)
      } catch (e) {
        if (!live) return
        setError((e as Error).message)
        if (busy) timer = setTimeout(read, intervalMs * 2)
      }
    }
    void read()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
    // busy restarts the loop when something starts; tick when the page asks.
  }, [pod, enabled, intervalMs, tick, busy])
  return { status, error, refresh: () => setTick((n) => n + 1) }
}
