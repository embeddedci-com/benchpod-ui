import { beforeAll, describe, expect, it } from 'vitest'
import wasmInline from './engine/sensor_def.wasm?inline'
import bmp280 from './testdata/bmp280.yaml?raw'
import sht4x from './testdata/sht4x.yaml?raw'
import { fromBase64, joinChunks } from './chunk'
import { convertSource } from './convert'
import { loadEngine, setEngineSource, type DefinitionKind, type Engine } from './engine'
import { commandSensorPod, regsBytes } from './pod'
import { convertFormat, copyLibraryEntry, makeZip, MemorySensorStore, SensorStoreError } from './store'
import { copyName, renameSource, TEMPLATES } from './templates'

let sd: Engine
beforeAll(async () => {
  setEngineSource(fromBase64(wasmInline.slice(wasmInline.indexOf(',') + 1)))
  sd = await loadEngine()
})

const engineCheck = (json: string, kind: DefinitionKind) => {
  const r = kind === 'stimulus' ? sd.stimulusValidate(json) : sd.validate(json)
  return r.ok ? null : r.error
}

describe('templates', () => {
  it.each(Object.keys(TEMPLATES) as DefinitionKind[])('the %s template compiles', (kind) => {
    const c = convertSource(TEMPLATES[kind])
    if (!c.ok) throw new Error(c.error)
    expect(c.doc.kind).toBe(kind)
    expect(engineCheck(c.json, kind)).toBeNull()
  })

  it('renames YAML in place and JSON by re-encoding', () => {
    expect(renameSource('format: 1\nname: a # x\nlabel: b\n', 'c')).toBe('format: 1\nname: c\nlabel: b\n')
    expect(JSON.parse(renameSource('{"name":"a"}', 'b')).name).toBe('b')
    expect(copyName('x'.repeat(32))).toHaveLength(32)
    expect(copyName('bme280', 2)).toBe('bme280_copy2')
  })
})

describe('MemorySensorStore', () => {
  const lib = { version: '0.1.0', entries: [{ source: bmp280 }, { source: sht4x }] }

  it('saves, lists, duplicates, refuses taken names and invalid files', async () => {
    const st = new MemorySensorStore(lib, engineCheck)
    const a = await st.save(TEMPLATES.i2c)
    expect(a).toMatchObject({ name: 'my_i2c_sensor', kind: 'i2c', source_format: 'yaml' })
    await expect(st.save(TEMPLATES.i2c)).rejects.toMatchObject({ code: 'name_taken' })
    const b = await st.duplicate(a.id)
    expect(b.name).toBe('my_i2c_sensor_copy')
    expect((await st.duplicate(a.id)).name).toBe('my_i2c_sensor_copy2')
    const broken = TEMPLATES.i2c.replace('sat_s16(temperature_c * 100)', 'sat_s16(temp * 100)')
    await expect(st.save(broken, a.id)).rejects.toBeInstanceOf(SensorStoreError)
    await expect(st.save(broken, a.id)).rejects.toThrow(/unknown name 'temp'/)
    expect((await st.list('i2c')).definitions.map((d) => d.name)).toEqual(['my_i2c_sensor', 'my_i2c_sensor_copy', 'my_i2c_sensor_copy2'])
    expect((await st.list('stimulus')).definitions).toEqual([])
    await st.delete(b.id)
    expect((await st.list()).definitions).toHaveLength(2)
  })

  it('uploads with replace, downloads in either format and zips', async () => {
    const st = new MemorySensorStore(lib)
    const up = await st.upload(new Blob([TEMPLATES.stimulus]), 'x.yaml')
    expect(up.replaced).toBe(false)
    await expect(st.upload(new Blob([TEMPLATES.stimulus]), 'x.yaml')).rejects.toMatchObject({ code: 'name_taken' })
    const again = await st.upload(new Blob([TEMPLATES.stimulus]), 'x.yaml', { replace: true })
    expect(again).toMatchObject({ replaced: true, definition: { id: up.definition.id } })
    const dl = await st.download(up.definition.id, 'json')
    expect(dl.filename).toBe('my_stimulus.json')
    expect(JSON.parse(await dl.blob.text()).signals.temperature_c).toHaveLength(4)
    await st.save(TEMPLATES.uart)
    const z = await st.zip()
    const bytes = new Uint8Array(await z.blob.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('stimuli/my_stimulus.yaml')
    expect(text).toContain('sensors/uart/my_uart_sensor.yaml')
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x04034b50)
  })

  it('copies library entries, renaming on a clash', async () => {
    const st = new MemorySensorStore(lib)
    expect((await st.library()).entries.map((e) => e.name)).toEqual(['bmp280', 'sht4x'])
    const a = await copyLibraryEntry(st, 'bmp280')
    const b = await copyLibraryEntry(st, 'bmp280')
    expect([a.name, b.name]).toEqual(['bmp280', 'bmp280_copy'])
    expect(b.source).toContain('# double-precision compensation') // comments survive
  })

  it('lets only admins change the library version', async () => {
    await expect(new MemorySensorStore(lib).setLibraryVersion('latest')).rejects.toMatchObject({ code: 'forbidden' })
    const st = new MemorySensorStore(lib, undefined, { canChangeLibrary: true })
    expect((await st.setLibraryVersion('0.2.0')).override).toBe('0.2.0')
    await expect(st.setLibraryVersion('nope')).rejects.toBeInstanceOf(SensorStoreError)
  })

  it('converts between formats', () => {
    const j = convertFormat(TEMPLATES.analog, 'json')
    expect(JSON.parse(j).range).toEqual({ min: 0, max: 3.3 })
    expect(convertSource(convertFormat(j, 'yaml'))).toMatchObject({ ok: true, doc: JSON.parse(j) })
    expect(makeZip([]).size).toBe(22)
  })
})

describe('commandSensorPod', () => {
  it('sends the define chunks, start, set, faults, stimulus and stop', async () => {
    const sent: Record<string, unknown>[] = []
    const pod = commandSensorPod(async (c) => {
      sent.push(c)
      if (c.cmd === 'sensor_define' && (c.offset as number) + (fromBase64(c.data_b64 as string).length) >= (c.total as number)) {
        return { status: 'ok', instance: c.instance, kind: 'i2c', name: 'bme280' }
      }
      if (c.cmd === 'sensor_status') return { instances: [{ instance: 'env', kind: 'i2c', name: 'bme280', running: true }] }
      if (c.cmd === 'sensor_regs') return { data_b64: 'AAEC' }
      return {}
    })
    const json = convertSource(bmp280)
    if (!json.ok) throw new Error(json.error)
    const progress: number[] = []
    const r = await pod.define('env', json.json, { onProgress: (s) => progress.push(s) })
    expect(r).toMatchObject({ instance: 'env', kind: 'i2c' })
    const defs = sent.filter((c) => c.cmd === 'sensor_define') as { offset: number; total: number; data_b64: string }[]
    expect(joinChunks(defs)).toBe(json.json)
    expect(progress[progress.length - 1]).toBe(defs[0].total)
    sent.length = 0
    await pod.start('env', { pins: { sda: 2, scl: 1 }, address: '0x77', values: {} })
    await pod.set('env', { temperature_c: 31.5 })
    await pod.fault('env', { type: 'corrupt', at: 0xf7, mask: 1, duration_s: 2 })
    await pod.faultClear('env')
    await pod.stimulus('{"format":1,"kind":"stimulus","signals":{}}')
    await pod.stimulusStart()
    await pod.stimulusStop()
    await pod.stop('env')
    await pod.stop()
    expect(sent).toEqual([
      { cmd: 'sensor_start', instance: 'env', pins: { sda: 2, scl: 1 }, address: '0x77' },
      { cmd: 'sensor_set', instance: 'env', values: { temperature_c: 31.5 } },
      { cmd: 'sensor_fault', instance: 'env', type: 'corrupt', at: '0xF7', mask: '0x01', duration_s: 2 },
      { cmd: 'sensor_fault_clear', instance: 'env' },
      expect.objectContaining({ cmd: 'sensor_stimulus', offset: 0 }),
      { cmd: 'sensor_stimulus_start' },
      { cmd: 'sensor_stimulus_stop' },
      { cmd: 'sensor_stop', instance: 'env' },
      { cmd: 'sensor_stop', all: true },
    ])
    expect((await pod.status()).instances[0].instance).toBe('env')
    expect(await pod.regs('env', 0xf7, 3)).toEqual(new Uint8Array([0, 1, 2]))
  })

  it('reads register bytes in every shape', () => {
    expect(regsBytes({ bytes: [1, '0x02', 255] })).toEqual(new Uint8Array([1, 2, 255]))
    expect(regsBytes({ data: 'a0 ff' })).toEqual(new Uint8Array([0xa0, 0xff]))
    expect(regsBytes({})).toEqual(new Uint8Array())
  })
})
