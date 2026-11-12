// Driving the pod's emulated sensors. SensorPod is what the pages call; commandSensorPod builds
// it over any way of sending one pod command (the web app's server proxy, the desktop app's
// local API). Every command name and field is in this file, so a change in the firmware's API
// (benchpod-firmware docs/sensors-api-draft.md, still a draft) is a change here only.
import { chunkCommands, fromBase64 } from './chunk'
import type { ParamInfo, SensorKind } from './engine'

/** Pins by role (`sda`, `scl`, `tx`, ...): LA channels (1..14) or wiring names. Analog: `output`. */
export type SensorPins = Record<string, number | string>

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
  i2c?: { address: string; alt_addresses?: string[] }
}

export type StartReply = { instance: string; slot?: string; image?: string; image_loaded?: boolean; unavailable?: string[] }

export type InstanceStatus = {
  instance: string
  kind: SensorKind
  name: string
  slot?: string
  running: boolean
  address?: string
  pins?: SensorPins
  values?: Record<string, number>
  faults?: { type: string; [k: string]: unknown }[]
  /** Bus counters: transfers, writes, last_write {at, value} (I2C/SPI); sent_bytes, received_bytes,
   * messages, overruns (UART). */
  bus?: Record<string, unknown>
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
  /** Stop one instance, or all of them without one. */
  stop(instance?: string): Promise<void>
  status(): Promise<PodSensorStatus>
  /** The bytes the DUT reads now from an I2C/SPI instance's image. */
  regs(instance: string, start: number, len: number): Promise<Uint8Array>
}

/** Send one pod command and return its reply's data; reject with the pod's error. */
export type SendCommand = (command: Record<string, unknown>) => Promise<Record<string, unknown>>

/** The capability a pod announces when it plays user-defined sensors. */
export const SENSORS_CAPABILITY = 'sensors'

const hex = (n: number | string) => (typeof n === 'number' ? `0x${n.toString(16).toUpperCase().padStart(2, '0')}` : n)

/** The bytes of a sensor_regs reply, whichever way the firmware sends them. */
export function regsBytes(r: Record<string, unknown>): Uint8Array {
  for (const k of ['data_b64', 'bytes_b64', 'b64']) if (typeof r[k] === 'string') return fromBase64(r[k] as string)
  for (const k of ['bytes', 'data', 'values', 'regs']) {
    const v = r[k]
    if (Array.isArray(v)) return Uint8Array.from(v.map((x) => (typeof x === 'string' ? parseInt(x, 16) : Number(x)) & 0xff))
    if (typeof v === 'string' && /^[0-9a-fA-F\s]*$/.test(v)) {
      const t = v.replace(/\s+/g, '')
      return Uint8Array.from(t.match(/../g)?.map((x) => parseInt(x, 16)) ?? [])
    }
  }
  return new Uint8Array()
}

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
      const r = await upload('sensor_define', json, { instance, ...opts })
      return { instance, ...r } as DefineReply
    },
    async start(instance, opts) {
      const r = await send({
        cmd: 'sensor_start',
        instance,
        pins: opts.pins,
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
      await send(instance ? { cmd: 'sensor_stop', instance } : { cmd: 'sensor_stop', all: true })
    },
    async status() {
      const r = await send({ cmd: 'sensor_status' })
      return { ...r, instances: Array.isArray(r.instances) ? (r.instances as InstanceStatus[]) : [] } as PodSensorStatus
    },
    async regs(instance, start, len) {
      const r = await send({ cmd: 'sensor_regs', instance, start: hex(start), len })
      return regsBytes(r)
    },
  }
}
