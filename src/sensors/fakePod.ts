// A pod in memory that answers the sensor commands (sensors-api draft), for tests and for
// working on a host's pages without hardware. It reassembles chunked uploads like the pod and,
// given the engine, compiles definitions with it.
import { fromBase64 } from './chunk'
import type { Engine, SensorKind } from './engine'
import type { InstanceStatus, SendCommand } from './pod'

export type FakePod = {
  send: SendCommand
  /** Every command received, oldest first. */
  commands: Record<string, unknown>[]
  instances: Map<string, InstanceStatus & { json: string }>
  stimulus: { json: string | null; running: boolean }
}

export function fakePod(engine?: Engine): FakePod {
  const uploads = new Map<string, { total: number; got: Uint8Array; next: number }>()
  const defined = new Map<string, { json: string; kind: SensorKind; name: string; params: { key: string; default: number }[] }>()
  const pod: FakePod = { send: async () => ({}), commands: [], instances: new Map(), stimulus: { json: null, running: false } }

  const chunk = (key: string, c: Record<string, unknown>): string | null => {
    const off = Number(c.offset)
    const total = Number(c.total)
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
    switch (c.cmd) {
      case 'sensor_define': {
        const json = chunk(`def:${instance}`, c)
        if (json === null) return { instance, received: Number(c.offset) + fromBase64(String(c.data_b64)).length }
        const v = engine?.validate(json)
        if (v && !v.ok) throw new Error(`invalid definition: ${v.error}`)
        const doc = JSON.parse(json) as { kind: SensorKind; name: string; params?: { key: string; default?: number }[] }
        const params = (v && v.ok ? v.params : (doc.params ?? []).map((p) => ({ key: p.key, default: p.default ?? 0 }))) as { key: string; default: number }[]
        if (!c.dry_run) {
          pod.instances.delete(instance)
          defined.set(instance, { json, kind: doc.kind, name: doc.name, params })
        }
        return { instance, kind: doc.kind, name: doc.name, params }
      }
      case 'sensor_start': {
        const d = defined.get(instance)
        if (!d) throw new Error(`no definition for instance ${instance}`)
        const values = Object.fromEntries(d.params.map((p) => [p.key, p.default]))
        Object.assign(values, (c.values as Record<string, number>) ?? {})
        pod.instances.set(instance, {
          instance,
          kind: d.kind,
          name: d.name,
          running: true,
          slot: `${d.kind}0`,
          address: typeof c.address === 'string' ? c.address : undefined,
          pins: c.pins as Record<string, number>,
          values,
          faults: [],
          bus: d.kind === 'uart' ? { sent_bytes: 0, received_bytes: 0, messages: 0, overruns: 0 } : { transfers: 0, writes: 0 },
          json: d.json,
        })
        return { instance, slot: `${d.kind}0`, image: 'emulation', image_loaded: false }
      }
      case 'sensor_set': {
        const i = pod.instances.get(instance)
        if (!i) throw new Error(`instance ${instance} is not running`)
        i.values = { ...i.values, ...(c.values as Record<string, number>) }
        return { instance }
      }
      case 'sensor_fault': {
        const i = pod.instances.get(instance)
        if (!i) throw new Error(`instance ${instance} is not running`)
        const { cmd: _c, instance: _i, ...f } = c
        void _c
        void _i
        i.faults = [...(i.faults ?? []), f as { type: string }]
        return { instance }
      }
      case 'sensor_fault_clear': {
        const i = pod.instances.get(instance)
        if (i) i.faults = []
        return { instance }
      }
      case 'sensor_stop':
        if (c.all) pod.instances.clear()
        else pod.instances.delete(instance)
        return {}
      case 'sensor_stimulus': {
        const json = chunk('stim', c)
        if (json !== null) {
          const v = engine?.stimulusValidate(json)
          if (v && !v.ok) throw new Error(`invalid stimulus: ${v.error}`)
          pod.stimulus = { json, running: false }
        }
        return {}
      }
      case 'sensor_stimulus_start':
        if (!pod.stimulus.json) throw new Error('no stimulus loaded')
        pod.stimulus.running = true
        return {}
      case 'sensor_stimulus_stop':
        pod.stimulus.running = false
        return {}
      case 'sensor_status':
        // The DUT polls each sensor between two status reads.
        for (const i of pod.instances.values()) if (i.bus && 'transfers' in i.bus) i.bus.transfers = Number(i.bus.transfers) + 3
        return {
          image: 'emulation',
          stimulus: { loaded: !!pod.stimulus.json, running: pod.stimulus.running, t_s: 0 },
          instances: [...pod.instances.values()].map(({ json: _j, ...i }) => (void _j, i)),
        }
      case 'sensor_regs': {
        const i = pod.instances.get(instance)
        if (!i || !engine) throw new Error(`instance ${instance} is not running`)
        const p = engine.preview(i.json, i.values ?? null)
        const start = parseInt(String(c.start), 16) || 0
        const len = Number(c.len) || 1
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
