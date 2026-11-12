// The sensor definition engine in the browser: the pod's own compiler (benchpod-firmware
// stm32h563/wasm, vendored in ./engine), so the editor validates and previews a definition with
// the code the pod runs. Loaded once, lazily; every call is synchronous after that.
//
// The host can point it elsewhere before the first use (setEngineSource): the desktop app may
// serve the .wasm from its own bundle, and the tests pass the bytes.
import { loadSensorDef, type SensorDef } from './engine/sensor_def.mjs'

export type SensorKind = 'i2c' | 'spi' | 'uart' | 'analog'
export type DefinitionKind = SensorKind | 'stimulus'

/** An engine error: `path: message` plus where it is. */
export type EngineError = {
  ok: false
  error: string
  code?: number
  path?: string
  message?: string
  json_off?: number
  expr_off?: number
}

export type ParamInfo = { key: string; unit?: string; label?: string; min: number; max: number; default: number }

export type ValidateOk = {
  ok: true
  kind: SensorKind
  name: string
  label: string
  program_bytes: number
  params: ParamInfo[]
  bus?: { address?: number; alt?: number[]; [k: string]: unknown } | null
  dynamic?: number[]
  read_only?: number[]
  uart?: { baud: number; data_bits: number; parity: string; stop_bits: number; messages: number; requests: number }
  analog?: { output: 'voltage' | 'current'; excitation: string; min: number; max: number }
}
export type ValidateResult = ValidateOk | EngineError

export type RegsPreview = {
  ok: true
  kind: 'i2c' | 'spi'
  t_ms: number
  power_on: boolean
  image_b64: string
  image: Uint8Array
  changed: number[]
  dynamic: number[]
  read_only: number[]
}
export type UartPreview = {
  ok: true
  kind: 'uart'
  t_ms: number
  epochs: number
  at_ms: number | null
  text: string
  bytes_b64: string
  bytes: Uint8Array
  next_ms: number | null
}
export type AnalogPreview = { ok: true; kind: 'analog'; t_ms: number; value: number | null; unit: 'V' | 'mA' }
export type PreviewResult = RegsPreview | UartPreview | AnalogPreview | EngineError

export type UartAnswerResult =
  | { ok: true; answers: { after_byte: number; delay_ms: number; text: string; bytes_b64: string; bytes: Uint8Array }[] }
  | EngineError

export type StimulusFault = {
  type: string
  at_s: number
  duration_s: number | null
  sensor?: string | null
  param?: string | null
  value?: number | null
  rate_hz?: number
  at?: number
  mask?: number
}
export type StimulusValidateResult =
  | {
      ok: true
      kind: 'stimulus'
      name: string | null
      program_bytes: number
      rate_hz: number
      duration_s: number
      repeat: boolean
      signals: { name: string; instance: string | null; param: string }[]
      faults: StimulusFault[]
    }
  | EngineError

export type StimulusSampleResult =
  | {
      ok: true
      from_s: number
      to_s: number
      step_s: number
      t: number[]
      signals: { name: string; instance: string | null; param: string; values: (number | null)[] }[]
      faults: (StimulusFault & { index: number; windows: [number, number | null][] })[]
    }
  | EngineError

/** The engine with typed calls. Definitions are JSON text or a parsed object. */
export type Engine = {
  validate(def: string | object): ValidateResult
  preview(
    def: string | object,
    values?: Record<string, number> | null,
    opts?: { liveRegs?: Uint8Array | string | null; tMs?: number; input?: number },
  ): PreviewResult
  uartAnswer(def: string | object, values: Record<string, number> | null, request: string | Uint8Array, opts?: { tMs?: number }): UartAnswerResult
  stimulusValidate(stim: string | object): StimulusValidateResult
  stimulusSample(stim: string | object, fromS: number, toS: number, stepS: number): StimulusSampleResult
}

type Source = URL | string | ArrayBuffer | Uint8Array | WebAssembly.Module

let source: Source | null = null
let loading: Promise<Engine> | null = null

/** Where to load the engine from (a URL, the bytes or a compiled module). Call before the first
 * loadEngine; a later call starts a new load. */
export function setEngineSource(src: Source): void {
  source = src
  loading = null
}

/** The engine, loaded once. */
export function loadEngine(): Promise<Engine> {
  if (!loading) {
    // `new URL(..., import.meta.url)` is the form Vite emits as an asset in a build and serves as is
    // in development, in both hosts.
    const src = source ?? new URL('./engine/sensor_def.wasm', import.meta.url)
    loading = loadSensorDef(src as URL).then((sd: SensorDef) => sd as unknown as Engine)
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** Engine errors as one line: "path: message" (the engine's own `error`). */
export function engineErrorText(e: EngineError): string {
  return e.error || (e.path ? `${e.path}: ${e.message ?? ''}` : (e.message ?? 'invalid'))
}
