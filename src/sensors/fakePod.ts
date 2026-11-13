// A pod in memory that answers the sensor commands (benchpod-firmware docs/API.md, "Emulated
// sensors"), for tests and for working on a host's pages without hardware. It reassembles chunked
// uploads like the pod and, given the engine, compiles definitions with it. Its replies and error
// texts are the firmware's.
import { fromBase64 } from './chunk'
import type { Engine, SensorKind } from './engine'
import { INSTANCE_ERROR, INSTANCE_RE, type InstanceStatus, type SendCommand, type SensorFault } from './pod'

/** Instances per sensor_status page (the pod fills a 1792-byte reply; six typical ones fit). */
export const FAKE_STATUS_PAGE = 6

const slotFor = (kind: SensorKind, used: Set<string>, output?: unknown): string => {
  if (kind === 'analog') return output === 'current' ? 'analog1' : 'analog0'
  if (kind === 'i2c') {
    for (let n = 0; n < 4; n++) if (!used.has(`i2c${n}`)) return `i2c${n}`
    throw new Error('all 4 I2C sensor slots are in use: sensor_stop one first')
  }
  return `${kind}0`
}

export type FakePod = {
  send: SendCommand
  /** Every command received, oldest first. */
  commands: Record<string, unknown>[]
  instances: Map<string, InstanceStatus & { json: string }>
  stimulus: { json: string | null; running: boolean }
}

export function fakePod(engine?: Engine, opts: { statusPage?: number } = {}): FakePod {
  const page = opts.statusPage ?? FAKE_STATUS_PAGE
  const uploads = new Map<string, { total: number; got: Uint8Array; next: number }>()
  const defined = new Map<string, { json: string; kind: SensorKind; name: string; params: { key: string; default: number }[] }>()
  const pod: FakePod = { send: async () => ({}), commands: [], instances: new Map(), stimulus: { json: null, running: false } }

  const chunk = (key: string, c: Record<string, unknown>): string | null => {
    const off = Number(c.offset)
    const total = Number(c.total)
    if (!(total >= 1 && total <= 32768)) throw new Error('total must be 1..32768 bytes')
    if (String(c.data_b64).length > 1240) throw new Error('data_b64 too long: at most 1240 characters per chunk')
    if (off === 0) uploads.set(key, { total, got: new Uint8Array(total), next: 0 })
    const u = uploads.get(key)
    if (!u || off !== u.next) throw new Error(`chunk at offset ${off}, expected ${u?.next ?? 0}`)
    const b = fromBase64(String(c.data_b64))
    u.got.set(b, off)
    u.next += b.length
    if (u.next < u.total) return null
    uploads.delete(key)
    return new TextDecoder().decode(u.got)
  }

  pod.send = async (c) => {
    pod.commands.push(c)
    const instance = String(c.instance ?? '')
    if (c.instance !== undefined && !INSTANCE_RE.test(instance)) throw new Error(INSTANCE_ERROR)
    const running = (name: string) => {
      const i = pod.instances.get(name)
      if (!i) throw new Error(`unknown sensor instance '${name}'`)
      return i
    }
    switch (c.cmd) {
      case 'sensor_define': {
        const json = chunk(`def:${instance}`, c)
        if (json === null) return { instance, received: Number(c.offset) + fromBase64(String(c.data_b64)).length }
        const v = engine?.validate(json)
        if (v && !v.ok) throw new Error(`invalid definition: ${v.error}`)
        const doc = JSON.parse(json) as { kind: SensorKind; name: string; params?: { key: string; default?: number }[] }
        const params = (v && v.ok ? v.params : (doc.params ?? []).map((p) => ({ key: p.key, default: p.default ?? 0 }))) as { key: string; default: number }[]
        if (!c.dry_run) {
          if (!defined.has(instance) && defined.size >= 8) throw new Error('8 instances are defined already: sensor_stop one first')
          pod.instances.delete(instance)
          defined.set(instance, { json, kind: doc.kind, name: doc.name, params })
        }
        return { instance, kind: doc.kind, name: doc.name, params }
      }
      case 'sensor_start': {
        const d = defined.get(instance)
        if (!d) throw new Error(`unknown sensor instance '${instance}'`)
        if (pod.instances.has(instance)) throw new Error(`${instance} is running: sensor_stop it first`)
        const pins = (c.pins ?? {}) as Record<string, unknown>
        for (const [k, v] of Object.entries(pins)) if (k !== 'output' && typeof v !== 'number' && !/^LA\d{1,2}$/i.test(String(v))) throw new Error(`pins.${k}: an LA channel (1..14)`)
        if (d.kind === 'i2c' && (pins.sda === undefined || pins.scl === undefined)) throw new Error('an I2C sensor needs pins sda and scl')
        if (d.kind === 'spi' && pins.drdy !== undefined) throw new Error('the emulated SPI target has no data-ready pin')
        const used = new Set([...pod.instances.values()].map((i) => i.slot ?? ''))
        const slot = slotFor(d.kind, used, pins.output)
        if (used.has(slot)) throw new Error(`the ${slot} slot is in use: sensor_stop one first`)
        const values = Object.fromEntries(d.params.map((p) => [p.key, p.default]))
        Object.assign(values, (c.values as Record<string, number>) ?? {})
        pod.instances.set(instance, {
          instance,
          kind: d.kind,
          name: d.name,
          running: true,
          slot,
          address: typeof c.address === 'string' ? c.address : undefined,
          pins: pins as Record<string, number>,
          values,
          faults: [],
          ...(d.kind === 'analog'
            ? { output: 0 }
            : {
                bus:
                  d.kind === 'uart'
                    ? { sent_bytes: 0, received_bytes: 0, messages: 0, answers: 0, overruns: 0, dropped: 0 }
                    : { writes: 0, transfers: null, log_lost: 0, drdy: 0 },
              }),
          json: d.json,
        })
        const digital = d.kind !== 'analog'
        return {
          instance,
          slot,
          ...(digital ? { image: 'emulation', image_loaded: false, unavailable: ['dac_control_loop', 'deep_replay'] } : {}),
          ...(typeof c.address === 'string' ? { address: c.address } : {}),
        }
      }
      case 'sensor_set': {
        const i = running(instance)
        const d = defined.get(instance)
        const vals = (c.values ?? {}) as Record<string, number>
        for (const k of Object.keys(vals)) if (d && !d.params.some((p) => p.key === k)) throw new Error(`${instance} has no param '${k}'`)
        i.values = { ...i.values, ...vals }
        return { instance, values: vals }
      }
      case 'sensor_fault': {
        const i = running(instance)
        const { cmd: _c, instance: _i, duration_s, ...f } = c
        void _c
        void _i
        if (f.type === 'bus_stuck' && (typeof duration_s !== 'number' || duration_s > 1)) throw new Error('bus_stuck needs a duration_s of at most 1 s')
        if ((i.faults ?? []).length >= 4) throw new Error(`${instance} has 4 faults on: clear them first`)
        i.faults = [...(i.faults ?? []), { ...(f as SensorFault), left_s: typeof duration_s === 'number' ? duration_s : null }]
        return { instance, fault: String(f.type) }
      }
      case 'sensor_fault_clear': {
        running(instance).faults = []
        return { instance, faults: [] }
      }
      case 'sensor_stop': {
        const names = c.all ? [...new Set([...defined.keys(), ...pod.instances.keys()])] : [instance]
        if (!c.all && !defined.has(instance) && !pod.instances.has(instance)) throw new Error(`unknown sensor instance '${instance}'`)
        for (const n of names) {
          pod.instances.delete(n)
          defined.delete(n)
        }
        if (pod.stimulus.running) pod.stimulus.running = false
        return { stopped: names }
      }
      case 'sensor_stimulus': {
        const json = chunk('stim', c)
        if (json !== null) {
          const v = engine?.stimulusValidate(json)
          if (v && !v.ok) throw new Error(`invalid stimulus: ${v.error}`)
          pod.stimulus = { json, running: false }
          return { program_bytes: json.length, signals: [], faults: 0, duration_s: 0, repeat: false }
        }
        return { received: Number(c.offset) + fromBase64(String(c.data_b64)).length }
      }
      case 'sensor_stimulus_start':
        if (!pod.stimulus.json) throw new Error('no stimulus loaded')
        pod.stimulus.running = true
        return { running: true }
      case 'sensor_stimulus_stop':
        pod.stimulus.running = false
        return { running: false }
      case 'sensor_status': {
        // The DUT writes a byte to each I2C/SPI sensor between two status reads.
        for (const i of pod.instances.values()) if (i.bus && 'writes' in i.bus) i.bus.writes = Number(i.bus.writes) + 1
        if (c.instance !== undefined) running(instance)
        const all = [...pod.instances.values()].filter((i) => c.instance === undefined || i.instance === instance).map(({ json: _j, ...i }) => (void _j, i))
        const first = Number(c.first ?? 0)
        const out: Record<string, unknown> = {
          image: 'emulation',
          stimulus: { loaded: !!pod.stimulus.json, running: pod.stimulus.running, t_s: 0 },
          instances: all.slice(first, first + page),
        }
        if (first + page < all.length) out.next = first + page
        return out
      }
      case 'sensor_regs': {
        const i = running(instance)
        if (i.kind !== 'i2c' && i.kind !== 'spi') throw new Error(`sensor_regs reads I2C and SPI sensors; ${instance} is a ${i.kind} sensor`)
        if (!engine) throw new Error('the fake pod has no engine')
        const p = engine.preview(i.json, i.values ?? null)
        const start = typeof c.start === 'number' ? c.start : parseInt(String(c.start ?? '0'), String(c.start ?? '').startsWith('0x') ? 16 : 10) || 0
        const len = c.len === undefined ? 256 - start : Number(c.len)
        if (start < 0 || start > 255 || len < 1 || len > 256) throw new Error('start is 0..255 and len 1..256')
        const img = p.ok && 'image' in p ? p.image : new Uint8Array(256)
        const out = new Uint8Array(len)
        for (let k = 0; k < len; k++) out[k] = img[(start + k) & 0xff]
        let s = ''
        for (const b of out) s += String.fromCharCode(b)
        return { instance, start: c.start, len, data_b64: btoa(s) }
      }
    }
    throw new Error(`unknown command ${String(c.cmd)}`)
  }
  return pod
}
