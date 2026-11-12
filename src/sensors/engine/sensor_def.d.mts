// Types for the vendored sensor_def.mjs (benchpod-firmware stm32h563/wasm). The module itself is
// plain JavaScript and is copied byte for byte (scripts/update-sensor-engine.sh); its README
// documents the JSON each call returns, typed in ../engine.ts.

export const ABI_VERSION: number
export function base64ToBytes(b64: string): Uint8Array
export function bytesToBase64(bytes: Uint8Array): string
export function loadSensorDef(
  source: URL | string | Response | ArrayBuffer | Uint8Array | WebAssembly.Module,
): Promise<SensorDef>

export class SensorDef {
  abiVersion: number
  validateRaw(def: string | object): string
  previewRaw(
    def: string | object,
    values?: Record<string, number> | null,
    opts?: { liveRegs?: Uint8Array | string | null; tMs?: number; input?: number },
  ): string
  uartAnswerRaw(def: string | object, values: Record<string, number> | null, request: string | Uint8Array, opts?: { tMs?: number }): string
  stimulusValidateRaw(stim: string | object): string
  stimulusSampleRaw(stim: string | object, fromS: number, toS: number, stepS: number): string
  validate(def: string | object): any
  preview(
    def: string | object,
    values?: Record<string, number> | null,
    opts?: { liveRegs?: Uint8Array | string | null; tMs?: number; input?: number },
  ): any
  uartAnswer(def: string | object, values: Record<string, number> | null, request: string | Uint8Array, opts?: { tMs?: number }): any
  stimulusValidate(stim: string | object): any
  stimulusSample(stim: string | object, fromS: number, toS: number, stepS: number): any
}
