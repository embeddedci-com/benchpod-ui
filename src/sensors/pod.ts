// Driving the pod's emulated sensors. SensorPod is what the pages call; commandSensorPod builds
// it over any way of sending one pod command (the web app's server proxy, the desktop app's
// local API). Every command name and field is in this file, so a change in the firmware's API
// (benchpod-firmware docs/API.md, section "Emulated sensors") is a change here only.
import { chunkCommands, fromBase64 } from './chunk'
import type { ParamInfo, SensorKind } from './engine'

/** Pins by role (`sda`, `scl`, `tx`, ...): LA channels, `3` or `"LA3"` (the pod does not know
 * wiring names: hosts resolve them first). Analog: `output`, `"dac"` or `"current"`. */
export type SensorPins = Record<string, number | string>

/** Instance names the pod takes: 1 to 16 characters of a-z, 0-9 and _ (a definition's `name`
 * may have 32). */
export const INSTANCE_RE = /^[a-z0-9_]{1,16}$/
export const INSTANCE_ERROR = 'instance must be 1..16 characters of a-z, 0-9 and _'
export const isInstanceName = (s: string) => INSTANCE_RE.test(s)

/** A default instance name for a definition: its `name`, cut to 16 characters. */
export function instanceFor(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 16).replace(/_+$/, '')
  return s || 'sensor'
}

/** The LA channel of a pin value (`3`, `"3"`, `"LA3"`), or null. */
export function laChannel(v: number | string): number | null {
  const m = typeof v === 'number' ? String(v) : /^(?:la)?(\d{1,2})$/i.exec(v.trim())?.[1]
  const n = m === undefined ? NaN : Number(m)
  return Number.isInteger(n) && n >= 1 && n <= 14 ? n : null
}

/** Pins as the pod takes them: LA channel numbers, analog `output` as is. A wiring name or a
 * channel out of range throws (hosts resolve wiring names before the start). */
export function podPins(pins: SensorPins): SensorPins {
  const out: SensorPins = {}
  for (const [k, v] of Object.entries(pins)) {
    if (v === undefined || v === null || v === '') continue
    if (k === 'output') {
      out[k] = v
      continue
    }
    const la = laChannel(v)
    if (la === null) throw new Error(`pin ${k}: ${JSON.stringify(v)} is not an LA channel (1..14); the pod takes channel numbers, not wiring names`)
    out[k] = la
  }
  return out
}

export type StartOptions = {
  pins: SensorPins
  /** I2C: the definition's address or one of its alternatives ("0x77"). */
  address?: string
  /** UART: overrides the definition's baud rate. */
  baud?: number
  /** Initial param values (otherwise the defaults). */
  values?: Record<string, number>
}

export type DefineReply = {
  instance: string
  kind: SensorKind
  name: string
  label?: string
  program_bytes?: number
  params?: ParamInfo[]
  /** The reply had no room for every param (`sensor_status` lists every value). */
  params_cut?: boolean
  i2c?: { address: string; alt_addresses?: string[] }
  spi?: { mode: number }
  uart?: { baud: number; format: string }
  analog?: { output: 'voltage' | 'current'; min: number; max: number }
}

/** `slot`: `i2c0`..`i2c3`, `spi0`, `uart0`, `analog0` (DAC voltage output), `analog1` (4-20 mA). */
export type StartReply = {
  instance: string
  slot?: string
  image?: string
  image_loaded?: boolean
  address?: string
  baud?: number
  unavailable?: string[]
}

/** An active fault: `type`, the fields it was given, `left_s` (null: until cleared). */
export type SensorFault = {
  type: string
  left_s?: number | null
  stimulus?: boolean
  param?: string
  value?: number
  at?: string | number
  mask?: string | number
  rate_hz?: number
}

export type InstanceStatus = {
  instance: string
  kind: SensorKind
  name: string
  slot?: string
  running: boolean
  address?: string
  pins?: SensorPins
  values?: Record<string, number>
  faults?: SensorFault[]
  /** Bus counters. I2C/SPI: writes (the DUT's data bytes), transfers (always null: the gateware
   * counts bytes), log_lost, last_write {at, value}, drdy, fifo_frames, fifo_drops. UART:
   * sent_bytes, received_bytes, messages, answers, overruns, dropped. */
  bus?: Record<string, unknown>
  /** Analog: the value last driven (V or mA). */
  output?: number
}

export type PodSensorStatus = {
  image?: string
  stimulus?: { loaded: boolean; running: boolean; t_s?: number }
  instances: InstanceStatus[]
}

export type FaultSpec = {
  type: string
  duration_s?: number
  param?: string
  value?: number
  at?: string | number
  mask?: string | number
  rate_hz?: number
}

/** Upload progress: bytes sent of the total. */
export type Progress = (sent: number, total: number) => void

export interface SensorPod {
  /** Upload and compile a definition (JSON) as `instance`. A running instance of that name stops. */
  define(instance: string, json: string, opts?: { dryRun?: boolean; onProgress?: Progress }): Promise<DefineReply>
  start(instance: string, opts: StartOptions): Promise<StartReply>
  set(instance: string, values: Record<string, number>): Promise<void>
  /** Upload a stimulus (JSON); one is loaded at a time. */
  stimulus(json: string, opts?: { onProgress?: Progress }): Promise<void>
  stimulusStart(atS?: number): Promise<void>
  stimulusStop(): Promise<void>
  fault(instance: string, fault: FaultSpec): Promise<void>
  faultClear(instance: string): Promise<void>
  /** Stop one instance, or all of them without one. Resolves to the names the pod stopped. */
  stop(instance?: string): Promise<string[] | void>
  /** Every instance (the pod pages a long list; this reads every page), or `instance` only. */
  status(instance?: string): Promise<PodSensorStatus>
  /** The bytes the DUT reads now from an I2C/SPI instance's image. */
  regs(instance: string, start: number, len: number): Promise<Uint8Array>
}

/** Send one pod command and return its reply's data; reject with the pod's error. */
export type SendCommand = (command: Record<string, unknown>) => Promise<Record<string, unknown>>

/** The capability a pod announces when it plays user-defined sensors. */
export const SENSORS_CAPABILITY = 'sensors'

const hex = (n: number | string) => (typeof n === 'number' ? `0x${n.toString(16).toUpperCase().padStart(2, '0')}` : n)

/** The bytes of a sensor_regs reply: `{"instance","start","len","data_b64"}`, one reply. */
export function regsBytes(r: Record<string, unknown>): Uint8Array {
  if (typeof r.data_b64 !== 'string') throw new Error('sensor_regs reply has no data_b64')
  return fromBase64(r.data_b64)
}

const checkInstance = (instance: string) => {
  if (!INSTANCE_RE.test(instance)) throw new Error(INSTANCE_ERROR)
  return instance
}

/** Pages of `sensor_status` read at most (a guard against a pod that keeps answering `next`). */
const MAX_STATUS_PAGES = 16

export function commandSensorPod(send: SendCommand): SensorPod {
  const upload = async (cmd: 'sensor_define' | 'sensor_stimulus', json: string, opts: { instance?: string; dryRun?: boolean; onProgress?: Progress }) => {
    const cmds = chunkCommands(cmd, json, { instance: opts.instance, dryRun: opts.dryRun })
    let last: Record<string, unknown> = {}
    let sent = 0
    for (const c of cmds) {
      last = await send(c as unknown as Record<string, unknown>)
      sent = Math.min(c.total, sent + Math.floor((c.data_b64.length * 3) / 4))
      opts.onProgress?.(sent, c.total)
    }
    return last
  }
  return {
    async define(instance, json, opts = {}) {
      checkInstance(instance)
      const r = await upload('sensor_define', json, { instance, ...opts })
      return { instance, ...r } as DefineReply
    },
    async start(instance, opts) {
      const r = await send({
        cmd: 'sensor_start',
        instance: checkInstance(instance),
        pins: podPins(opts.pins),
        ...(opts.address ? { address: hex(opts.address) } : {}),
        ...(opts.baud ? { baud: opts.baud } : {}),
        ...(opts.values && Object.keys(opts.values).length ? { values: opts.values } : {}),
      })
      return { instance, ...r } as StartReply
    },
    async set(instance, values) {
      await send({ cmd: 'sensor_set', instance, values })
    },
    async stimulus(json, opts = {}) {
      await upload('sensor_stimulus', json, opts)
    },
    async stimulusStart(atS) {
      await send({ cmd: 'sensor_stimulus_start', ...(atS ? { at_s: atS } : {}) })
    },
    async stimulusStop() {
      await send({ cmd: 'sensor_stimulus_stop' })
    },
    async fault(instance, f) {
      const { type, ...rest } = f
      const fields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== '') fields[k] = k === 'at' || k === 'mask' ? hex(v as number) : v
      await send({ cmd: 'sensor_fault', instance, type, ...fields })
    },
    async faultClear(instance) {
      await send({ cmd: 'sensor_fault_clear', instance })
    },
    async stop(instance) {
      const r = await send(instance ? { cmd: 'sensor_stop', instance } : { cmd: 'sensor_stop', all: true })
      return Array.isArray(r.stopped) ? r.stopped.map(String) : []
    },
    async status(instance) {
      const req: Record<string, unknown> = { cmd: 'sensor_status', ...(instance ? { instance: checkInstance(instance) } : {}) }
      let r = await send(req)
      const instances: InstanceStatus[] = Array.isArray(r.instances) ? [...(r.instances as InstanceStatus[])] : []
      const seen = new Set([0])
      for (let pages = 1; typeof r.next === 'number' && r.next > 0 && !seen.has(r.next) && pages < MAX_STATUS_PAGES; pages++) {
        seen.add(r.next)
        const page = await send({ ...req, first: r.next })
        if (Array.isArray(page.instances)) instances.push(...(page.instances as InstanceStatus[]))
        r = { ...r, ...page, ...(page.next === undefined ? { next: undefined } : {}) }
      }
      const { next: _n, instances: _i, ...rest } = r
      void _n
      void _i
      return { ...rest, instances } as PodSensorStatus
    },
    async regs(instance, start, len) {
      if (!Number.isInteger(start) || start < 0 || start > 255) throw new Error(`start is 0..255 (the offset in the 256-byte image), got ${start}`)
      if (!Number.isInteger(len) || len < 1 || len > 256 - start) throw new Error(`len is 1..${256 - start} from start ${start}, got ${len}`)
      const r = await send({ cmd: 'sensor_regs', instance: checkInstance(instance), start: hex(start), len })
      return regsBytes(r)
    },
  }
}
