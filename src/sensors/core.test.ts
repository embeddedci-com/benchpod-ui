import { beforeAll, describe, expect, it } from 'vitest'
import { chunkCommands, fromBase64, joinChunks, MAX_CHUNK_BYTES, MAX_COMMAND_BYTES, toBase64 } from './chunk'
import { convertSource, detectFormat } from './convert'
import { loadEngine, setEngineSource, type Engine } from './engine'
import { lineOfPath, parseYaml, toYaml, YamlError, type YamlValue } from './yaml'

import wasmInline from './engine/sensor_def.wasm?inline'
import mjsInline from './engine/sensor_def.mjs?raw'
import sums from './engine/SHA256SUMS?raw'

// No Node APIs here (the package has no Node types): files come in through Vite.
const files = import.meta.glob('./testdata/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const read = (p: string) => {
  const f = files[p]
  if (f === undefined) throw new Error(`no fixture ${p}`)
  return f
}
const wasmBytes = () => fromBase64(wasmInline.slice(wasmInline.indexOf(',') + 1))
const sha256 = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('')

describe('parseYaml', () => {
  // testdata/*.json is what benchpod-sensors tools/yaml2json.py writes for each library file.
  const yamls = Object.keys(files).filter((f) => f.endsWith('.yaml'))
  it.each(yamls)('reads %s as yaml2json.py does', (f: string) => {
    const { value } = parseYaml(read(f))
    expect(value).toEqual(JSON.parse(read(f.replace('.yaml', '.json'))))
  })

  it('keeps YAML 1.1 booleans as strings (YAML 1.2 core)', () => {
    const { value } = parseYaml('on: yes\noff: no\nflag: true\nk: [on, True, ~, 0x10, 1_000, .5]\n')
    expect(value).toEqual({ on: 'yes', off: 'no', flag: true, k: ['on', true, null, 16, 1000, 0.5] })
  })

  it('reads block scalars, anchors, aliases and comments', () => {
    const { value } = parseYaml('a: &x [1, 2] # c\nb: *x\nd: |\n  one\n  two\ne: >-\n  folded\n  text\nf: "a # b"\n')
    expect(value).toEqual({ a: [1, 2], b: [1, 2], d: 'one\ntwo\n', e: 'folded text', f: 'a # b' })
  })

  it('records the line of every path', () => {
    const { locs } = parseYaml('format: 1\nregisters:\n  - { at: 0xD0, u8: 0x58 }\n  - at: 0xF4\n    s16be: "x"\n')
    expect(locs.get('registers[0].u8')).toBe(3)
    expect(locs.get('registers[1].s16be')).toBe(5)
    expect(lineOfPath(locs, 'registers[1].s16be')).toBe(5)
    expect(lineOfPath(locs, 'registers[1].nope.deeper')).toBe(4)
    expect(lineOfPath(locs, 'zzz')).toBeNull()
  })

  it('says which line it cannot read', () => {
    expect(() => parseYaml('a: 1\n b: 2\n')).toThrow(YamlError)
    try {
      parseYaml('a: 1\na: 2\n')
    } catch (e) {
      expect((e as YamlError).line).toBe(2)
    }
  })

  it('writes YAML that reads back the same', () => {
    const doc: YamlValue = {
      format: 1,
      kind: 'stimulus',
      name: 'hot',
      repeat: false,
      signals: {
        temperature_c: [
          { shape: 'hold', value: 22, duration_s: 5 },
          { shape: 'repeat', count: 2, segments: [{ shape: 'ramp', end: 30, duration_s: 1 }] },
          { shape: 'data', points: [[0, 1], [2, 3]], interpolate: 'linear' },
        ],
        on: [{ shape: 'step', value: 1 }],
      },
      faults: [{ at_s: 4, type: 'stuck', note: 'true' }],
    }
    expect(parseYaml(toYaml(doc)).value).toEqual(doc)
  })
})

describe('convertSource', () => {
  it('converts YAML and JSON to the same compact JSON', () => {
    const y = convertSource(read('./testdata/sht4x.yaml'))
    const j = convertSource(read('./testdata/sht4x.json'))
    expect(y.ok && j.ok).toBe(true)
    if (y.ok && j.ok) {
      expect(y.format).toBe('yaml')
      expect(j.format).toBe('json')
      expect(y.json).toBe(j.json)
    }
    expect(detectFormat('  {"a":1}')).toBe('json')
  })

  it('reports a YAML error with its line and refuses data files', () => {
    expect(convertSource('a: 1\n  b: [\n')).toMatchObject({ ok: false, line: 2 })
    const r = convertSource('kind: stimulus\nsignals:\n  t:\n    - { shape: data, file: x.csv }\n')
    expect(r).toMatchObject({ ok: false, line: 4 })
    expect(convertSource('x'.repeat(40000))).toMatchObject({ ok: false })
  })
})

describe('chunkCommands', () => {
  it('keeps every command under the cloud limit and joins back', () => {
    const json = read('./testdata/bme280.json').trim()
    const cmds = chunkCommands('sensor_define', json, { instance: 'env' })
    expect(cmds.length).toBeGreaterThan(1)
    for (const c of cmds) expect(new TextEncoder().encode(JSON.stringify(c) + '\n').length).toBeLessThanOrEqual(MAX_COMMAND_BYTES)
    expect(cmds[0]).toMatchObject({ cmd: 'sensor_define', instance: 'env', offset: 0, total: new TextEncoder().encode(json).length })
    expect(cmds.slice(0, -1).every((c) => fromBase64(c.data_b64).length % 3 === 0)).toBe(true)
    expect(joinChunks(cmds)).toBe(json)
  })

  it('handles a 32 KB definition, UTF-8 and dry runs', () => {
    const json = JSON.stringify({ label: 'é°µ'.repeat(2500), pad: 'x'.repeat(16000) })
    const cmds = chunkCommands('sensor_stimulus', json, { dryRun: true })
    expect(cmds.every((c) => c.instance === undefined)).toBe(true)
    expect(cmds.filter((c) => c.dry_run)).toHaveLength(1)
    expect(cmds[cmds.length - 1].dry_run).toBe(true)
    expect(joinChunks(cmds)).toBe(json)
    // 768 raw bytes per chunk at most (the firmware's documented chunk): 1152-byte commands.
    for (const c of cmds) expect(fromBase64(c.data_b64).length).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
    for (const c of cmds) expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThanOrEqual(1152)
    expect(cmds.length).toBe(Math.ceil(new TextEncoder().encode(json).length / MAX_CHUNK_BYTES))
  })

  it('rejects chunks out of order', () => {
    const cmds = chunkCommands('sensor_define', 'x'.repeat(3000), { instance: 'a' })
    expect(() => joinChunks([cmds[1], cmds[0]])).toThrow(/expected 0/)
  })

  it('round-trips base64', () => {
    const b = new Uint8Array([0, 1, 250, 255, 128])
    expect(fromBase64(toBase64(b))).toEqual(b)
    expect(fromBase64('-_8')).toEqual(new Uint8Array([0xfb, 0xff]))
  })
})

describe('engine', () => {
  let sd: Engine
  beforeAll(async () => {
    setEngineSource(wasmBytes())
    sd = await loadEngine()
  })

  it('matches the vendored record', async () => {
    const want = Object.fromEntries(sums.trim().split('\n').map((l) => [l.split(/\s+/)[1], l.split(/\s+/)[0]]))
    expect(Object.keys(want).sort()).toEqual(['sensor_def.mjs', 'sensor_def.wasm'])
    expect(await sha256(wasmBytes())).toBe(want['sensor_def.wasm'])
    expect(await sha256(new TextEncoder().encode(mjsInline))).toBe(want['sensor_def.mjs'])
  })

  it('validates and previews a library sensor converted from YAML', () => {
    const c = convertSource(read('./testdata/bmp280.yaml'))
    if (!c.ok) throw new Error(c.error)
    const v = sd.validate(c.json)
    expect(v).toMatchObject({ ok: true, kind: 'i2c', name: 'bmp280' })
    const p = sd.preview(c.json, { temperature_c: 30 })
    expect(p.ok && p.kind === 'i2c' && p.image.length).toBe(256)
  })

  it('reports an error path the YAML locations resolve', () => {
    const src = read('./testdata/mpu6050.yaml').replace('on * accel_x_g * al', 'on * acel_x_g * al')
    const c = convertSource(src)
    if (!c.ok) throw new Error(c.error)
    const v = sd.validate(c.json)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toContain("unknown name 'acel_x_g'")
      const line = lineOfPath(c.locs, v.path)
      expect(src.split('\n')[(line ?? 0) - 1]).toContain('acel_x_g')
    }
  })

  it('samples a stimulus', () => {
    const stim = { format: 1, kind: 'stimulus', signals: { t: [{ shape: 'ramp', start: 0, end: 10, duration_s: 10 }] }, faults: [{ at_s: 2, duration_s: 1, type: 'stuck' }] }
    const r = sd.stimulusSample(stim, 0, 10, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.signals[0].values[5]).toBeCloseTo(5)
      expect(r.faults[0].windows[0][0]).toBe(2)
    }
  })
})
