// @vitest-environment jsdom
// The repo has no Node types; this is the one Node API the tests use (Python's parser on the output).
// @ts-ignore
import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { BenchCall, BenchResult } from '../../bench/benchCall'
import { logRow, type BusLogRow } from '../busLog'
import { SEQUENCE_VERSION, stepDiff, stepFromRow, stepsFromRows, type BusSequence, type SequenceInput, type SequenceStep, type SequenceStore } from './model'
import { pyInt, pytestFileName, sequenceToPytest, slug } from './pytest'
import { runSequence } from './run'
import { httpSequenceStore } from './httpStore'
import { SequencesPanel } from './SequencesPanel'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

const ok = (structured: unknown): BenchResult => ({ text: JSON.stringify(structured), structured })
const err = (text: string): BenchResult => ({ text, is_error: true })
const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>)
const DATE = new Date('2026-11-13T12:00:00Z')

type Spawn = (cmd: string, args: string[], opts?: { input?: string; encoding?: 'utf8' }) => { status: number | null; stderr: string }
const spawnSync = nodeSpawnSync as Spawn

/** Python's own parser on the generated text, when a python3 is on the PATH. */
const python = spawnSync('python3', ['--version']).status === 0
function pyParse(code: string): string {
  const r = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read(), "test.py")'], { input: code, encoding: 'utf8' })
  return r.status === 0 ? 'ok' : r.stderr
}

const NAMES = ['i2c_sda', 'i2c_scl', 'READY', '', 'LED', '', '', '', '', '', '', '', 'spi_sclk', 'spi_mosi']

/** Every tool the export knows, as the dashboard logs them. */
const ALL: SequenceStep[] = [
  { tool: 'set_pull', args: { las: [1, 2], enabled: true } },
  { tool: 'i2c_open', args: { hz: 400000, pullups: 'pod' } },
  { tool: 'i2c_scan', args: { start: 8, end: 119 }, expect: { found: [0x76] } },
  { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: 'd0', read: 1 }, expect: { ack: true, rx_hex: '58' } },
  { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: 'f4 27', read: 0 }, expect: { ack: true } },
  { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: 'f7', read: 6 }, expect: { ack: true, rx_hex: '5a3c0080f000' } },
  { tool: 'i2c_transfer', args: { addr: 0x50, write_hex: '0001', read: 2 }, expect: { ack: false } },
  { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: '', read: 0 }, expect: { ack: true } },
  { tool: 'capture_la', args: { samples: 8192, sample_rate_hz: 12000000, send: { bus: 'i2c', addr: 0x76, write_hex: 'd0', read: 1 } }, expect: { send_ok: true, ack: true, rx_hex: '58' } },
  { tool: 'i2c_close', args: {} },
  { tool: 'gpio_mode', args: { la: [5], mode: 'output', level: 0 } },
  { tool: 'gpio_write', args: { la: [5], level: 1 } },
  { tool: 'gpio_read', args: { la: [3] }, expect: { levels: [{ la: 3, level: 1 }] } },
  { tool: 'gpio_wait', args: { la: 'READY', level: 1, timeout: 2 }, expect: { reached: true } },
  { tool: 'gpio_pulse', args: { la: 5, width: 0.001, count: 3 } },
  { tool: 'capture_la', args: { samples: 4096, send: { bus: 'gpio', la: 5, level: 0 } }, expect: { send_ok: true } },
  { tool: 'gpio_release', args: { la: [5] } },
  { tool: 'spi_transfer', args: { tx_hex: '9f000000', hz: 1000000, mode: 0 }, expect: { rx_hex: 'ffef4018' } },
  { tool: 'can_open', args: { bitrate: 500000, mode: 'normal', term: true } },
  { tool: 'can_write', args: { can_id: 0x123, data: [1, 2, 255], ext: false } },
  { tool: 'can_read', args: { timeout: 0.5, max_frames: 8 }, expect: { frames: [{ id: 0x321, data: [0xaa] }] } },
  { tool: 'can_close', args: {} },
  { tool: 'uart_open', args: { baud: 115200 } },
  { tool: 'uart_write', args: { text: 'status "now"', line_ending: 'crlf' } },
  { tool: 'uart_close', args: {} },
  { tool: 'flash', args: { file: 'fw.elf' } },
]

describe('pytest export', () => {
  it('names the file and the test from the sequence', () => {
    expect(pytestFileName('Read BME280 chip ID!')).toBe('test_read_bme280_chip_id.py')
    expect(slug('42 steps')).toBe('seq_42_steps')
    expect(slug('***')).toBe('sequence')
    expect(pyInt(400000)).toBe('400_000')
    expect(pyInt(115200)).toBe('115_200')
    expect(pyInt(4096)).toBe('4096')
  })

  it('writes every known step as SDK calls (snapshot)', async () => {
    const code = sequenceToPytest({ name: 'All the buses', steps: ALL }, { names: NAMES, date: DATE })
    await expect(code).toMatchFileSnapshot('__snapshots__/test_all_the_buses.py')
  })

  it('a short I2C sequence reads like hand-written code (snapshot)', async () => {
    const steps: SequenceStep[] = [
      { tool: 'set_pull', args: { las: [1, 2], enabled: true } },
      { tool: 'i2c_open', args: { sda: 1, scl: 2, hz: 100000 } },
      { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: 'd0', read: 1 }, expect: { ack: true, rx_hex: '58' } },
      { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: 'f427', read: 0 }, expect: { ack: true } },
    ]
    const code = sequenceToPytest({ name: 'Read chip id', steps }, { names: NAMES, date: DATE })
    await expect(code).toMatchFileSnapshot('__snapshots__/test_read_chip_id.py')
    expect(code).toContain('assert i2c.read_reg(0x76, 0xd0, 1) == bytes.fromhex("58")')
    expect(code).toContain('i2c.write_reg(0x76, 0xf4, bytes.fromhex("27"))')
    expect(code).toContain('bp.open_i2c(sda=1, scl=2, hz=100_000)')
  })

  it('a GPIO-only sequence needs no session stack', () => {
    const code = sequenceToPytest({ name: 'blink', steps: [{ tool: 'gpio_mode', args: { la: ['LED'], mode: 'output' } }, { tool: 'gpio_write', args: { la: ['LED'], level: 1 } }] }, { date: DATE })
    expect(code).not.toContain('ExitStack')
    expect(code).toContain('bp.configure_gpio(["LED"], "output")')
    expect(code).toContain('bp.set_gpio("LED", 1)')
  })

  it('opens an I2C session from the wiring when the sequence used one it did not open', () => {
    const code = sequenceToPytest({ name: 'x', steps: [{ tool: 'i2c_transfer', args: { addr: 0x48, read: 2 }, expect: { ack: true, rx_hex: '0102' } }] }, { date: DATE })
    expect(code).toContain('i2c = stack.enter_context(bp.open_i2c())')
    expect(code).toContain('assert i2c.read(0x48, 2) == bytes.fromhex("01 02")')
  })

  it('an empty sequence is still a valid test', () => {
    expect(sequenceToPytest({ name: 'empty', steps: [] }, { date: DATE })).toContain('    pass  # the sequence has no steps')
  })

  it.skipIf(!python)('the output parses as Python', () => {
    const cases: Pick<BusSequence, 'name' | 'steps'>[] = [
      { name: 'All the buses', steps: ALL },
      { name: 'empty', steps: [] },
      { name: 'quotes " and \\ and\nnew lines', steps: [{ tool: 'uart_write', args: { text: 'a "b" \\ c\n' } }] },
      ...ALL.map((s, i) => ({ name: `one ${i}`, steps: [s] })),
    ]
    for (const c of cases) expect([c.name, pyParse(sequenceToPytest(c, { names: NAMES }))]).toEqual([c.name, 'ok'])
  })
})

describe('steps from log rows', () => {
  const row = (id: number, time: number, tool: string, args: Record<string, unknown>, r: BenchResult): BusLogRow => logRow(id, time, 'I2C', tool, args, r)

  it('keeps the args and what a read saw, oldest first, and leaves out failed rows', () => {
    const rows = [
      row(3, 30, 'i2c_transfer', { addr: 0x76, write_hex: 'd0', read: 1 }, ok({ addr: 0x76, ack: true, rx_hex: '58' })),
      row(1, 10, 'i2c_open', { hz: 400000 }, ok({ open: true, sda: 1, scl: 2, hz: 400000 })),
      row(2, 20, 'i2c_transfer', { addr: 0x77, read: 1 }, err('no session')),
      row(4, 40, 'wiring', {}, ok({})),
    ]
    const all = stepsFromRows(rows, new Set([1, 2, 3, 4]))
    // The open was on the pod's pull-ups (the default) without a set_pull row: the setup switches them on.
    expect(all[0]).toEqual({ tool: 'set_pull', args: { las: [1, 2], enabled: true }, proto: 'I2C', setup: true })
    const steps = all.filter((s) => !s.setup)
    expect(steps.map((s) => s.tool)).toEqual(['i2c_open', 'i2c_transfer'])
    expect(steps[1]).toEqual({ tool: 'i2c_transfer', proto: 'I2C', args: { addr: 0x76, write_hex: 'd0', read: 1 }, expect: { ack: true, rx_hex: '58' } })
    expect(stepFromRow(rows[2])).toBeNull()
  })

  it('compares a run with the recording', () => {
    const s: SequenceStep = { tool: 'i2c_transfer', args: {}, expect: { ack: true, rx_hex: '58' } }
    expect(stepDiff(s, { ack: true, rx_hex: '58' })).toBeUndefined()
    expect(stepDiff(s, { ack: true, rx_hex: '60' })).toBe('read 60, recorded 58')
    expect(stepDiff(s, { ack: false, rx_hex: '' })).toBe('NACK, recorded ACK')
    expect(stepDiff({ tool: 'gpio_read', args: {}, expect: { levels: [{ la: 3, level: 1 }] } }, { levels: [{ la: 3, level: 0 }] })).toBe('LA3 = 0, recorded 1')
    expect(stepDiff({ tool: 'gpio_write', args: {} }, {})).toBeUndefined()
  })
})

describe('recorded setup (version 2)', () => {
  // The live test of 2026-11-14: an open with SDA LA2, SCL LA1, 100 kHz on the pod's pull-ups (switched
  // on from the pin strip, so not in the log), then two selected I2C rows.
  const LIVE_NAMES = ['i2c_scl', 'i2c_sda']
  let id = 0
  const r = (proto: BusLogRow['proto'], tool: string, args: Record<string, unknown>, data: unknown): BusLogRow => {
    id++
    return logRow(id, id * 10, proto, tool, args, ok(data))
  }
  const liveRows = () => {
    id = 0
    return [
      r('I2C', 'i2c_open', { sda: 2, scl: 1, hz: 100000, pullups: 'pod' }, { open: true, sda: 2, scl: 1, hz: 100000, pullups: 'pod' }),
      r('I2C', 'i2c_transfer', { addr: 0x42, write_hex: '10c33c', read: 0 }, { addr: 0x42, ack: true }),
      r('I2C', 'i2c_transfer', { addr: 0x42, write_hex: '10', read: 2 }, { addr: 0x42, ack: true, rx_hex: 'c33c' }),
    ]
  }

  it('carries an I2C session opened before the selection, with its pull-ups', () => {
    const steps = stepsFromRows(liveRows(), new Set([2, 3]))
    expect(steps.slice(0, 2)).toEqual([
      { tool: 'set_pull', args: { las: [2, 1], enabled: true }, proto: 'I2C', setup: true },
      { tool: 'i2c_open', args: { sda: 2, scl: 1, hz: 100000, pullups: 'pod' }, proto: 'I2C', setup: true },
    ])
    expect(steps.slice(2).map((s) => s.tool)).toEqual(['i2c_transfer', 'i2c_transfer'])
  })

  it('exports the recorded I2C setup (snapshot)', async () => {
    const steps = stepsFromRows(liveRows(), new Set([2, 3]))
    const code = sequenceToPytest({ name: 'Recorded setup I2C', steps }, { names: LIVE_NAMES, date: DATE })
    await expect(code).toMatchFileSnapshot('__snapshots__/test_recorded_setup_i2c.py')
    expect(code).toContain('bp.enable_pullup(2, 1)  # LA2 i2c_sda, LA1 i2c_scl')
    expect(code).toContain('i2c = stack.enter_context(bp.open_i2c(sda=2, scl=1, hz=100_000, pullups="pod"))')
    expect(code).toContain('i2c.write_reg(0x42, 0x10, bytes.fromhex("c3 3c"))')
    expect(code).toContain('assert i2c.read_reg(0x42, 0x10, 2) == bytes.fromhex("c3 3c")')
    expect(code).not.toContain('opened from the wiring')
  })

  it('board pull-ups: no set_pull, pullups="external"', () => {
    const rows = liveRows()
    rows[0] = logRow(1, 10, 'I2C', 'i2c_open', { hz: 400000, pullups: 'external' }, ok({ open: true, sda: 2, scl: 1, hz: 400000, pullups: 'external' }))
    const steps = stepsFromRows(rows, new Set([3]))
    expect(steps.map((s) => s.tool)).toEqual(['i2c_open', 'i2c_transfer'])
    expect(sequenceToPytest({ name: 'x', steps }, { date: DATE })).toContain('bp.open_i2c(sda=2, scl=1, hz=400_000, pullups="external")')
  })

  it('a selection that opens its own session gets no setup open, but the pod pull-ups it needed', () => {
    const steps = stepsFromRows(liveRows(), new Set([1, 2]))
    expect(steps.map((s) => `${s.tool}${s.setup ? ' (setup)' : ''}`)).toEqual(['set_pull (setup)', 'i2c_open', 'i2c_transfer'])
  })

  it('a closed session is not carried', () => {
    const rows = [...liveRows()]
    rows.splice(1, 0, logRow(99, 15, 'I2C', 'i2c_close', {}, ok({ open: false })))
    const steps = stepsFromRows(rows, new Set([3]))
    expect(steps.map((s) => s.tool)).toEqual(['i2c_transfer'])
  })

  it('SPI: the pins, mode and rate the call was recorded with (snapshot)', async () => {
    id = 0
    const rows = [
      r('SPI', 'spi_transfer', { tx_hex: '9f000000', sck: 13, mosi: 14, miso: 6, cs: 5, hz: 2000000, mode: 1 }, { rx_hex: 'ffef4018', hz: 2000000 }),
      r('SPI', 'capture_la', { samples: 4096, send: { bus: 'spi', tx_hex: '05', spi_hz: 2000000, spi_mode: 1 } }, { samples: 4096, sample_rate_hz: 24000000, send: { bus: 'spi', rx_hex: '00' } }),
    ]
    const steps = stepsFromRows(rows, new Set([1, 2]))
    expect(steps.some((s) => s.setup)).toBe(false)
    const code = sequenceToPytest({ name: 'Recorded setup SPI', steps }, { names: NAMES, date: DATE })
    await expect(code).toMatchFileSnapshot('__snapshots__/test_recorded_setup_spi.py')
    expect(code).toContain('with bp.open_spi(sck=13, mosi=14, miso=6, cs=5, hz=2_000_000, mode=1) as spi:  # LA13 spi_sclk, LA14 spi_mosi')
    expect(code).toContain('with bp.open_spi(hz=2_000_000, mode=1) as spi:')
  })

  it('CAN bitrate and GPIO modes opened before the selection', () => {
    id = 0
    const rows = [
      r('CAN', 'can_open', { bitrate: 250000, mode: 'normal', term: true }, { open: true, bitrate: 250000 }),
      r('GPIO', 'gpio_mode', { la: [5, 6], mode: 'output', level: 0 }, { pins: [] }),
      r('GPIO', 'gpio_mode', { la: [7], mode: 'open_drain' }, { pins: [] }),
      r('GPIO', 'gpio_write', { la: [5], level: 1 }, {}),
      r('CAN', 'can_write', { can_id: 0x123, data: [1, 2] }, {}),
      r('GPIO', 'gpio_write', { la: [5, 7], level: 0 }, {}),
      r('GPIO', 'gpio_write', { la: [6], level: 1 }, {}),
    ]
    const steps = stepsFromRows(rows, new Set([5, 6]))
    expect(steps.filter((s) => s.setup)).toEqual([
      { tool: 'can_open', args: { bitrate: 250000, mode: 'normal', term: true }, proto: 'CAN', setup: true },
      { tool: 'gpio_mode', args: { la: [5], mode: 'output', level: 1 }, proto: 'GPIO', setup: true },
      { tool: 'gpio_mode', args: { la: [7], mode: 'open_drain' }, proto: 'GPIO', setup: true },
    ])
    const code = sequenceToPytest({ name: 'x', steps }, { date: DATE })
    expect(code).toContain('can = stack.enter_context(bp.open_can(bitrate=250_000, mode="normal", term=True))')
    expect(code).toContain('bp.configure_gpio([5], "output", level=1)')
    expect(code).toContain('bp.configure_gpio([7], "open_drain")')
  })

  it('an old (version 1) sequence still exports as before: the session from the wiring', () => {
    const old: Pick<BusSequence, 'name' | 'steps'> = {
      name: 'old',
      steps: [
        { tool: 'i2c_transfer', args: { addr: 0x42, write_hex: '10c33c', read: 0 }, expect: { ack: true } },
        { tool: 'i2c_transfer', args: { addr: 0x42, write_hex: '10', read: 2 }, expect: { ack: true, rx_hex: 'c33c' } },
      ],
    }
    const code = sequenceToPytest(old, { date: DATE })
    expect(code).toContain('# The recorded sequence used a session it did not open; this one is opened from the wiring.')
    expect(code).toContain('i2c = stack.enter_context(bp.open_i2c())')
    expect(code).not.toContain('# Setup:')
  })

  it('a wiring name in set_pull becomes its channel (enable_pullup takes numbers)', () => {
    const code = sequenceToPytest({ name: 'x', steps: [{ tool: 'set_pull', args: { las: ['i2c_sda', 'OTHER'], enabled: true } }] }, { names: LIVE_NAMES, date: DATE })
    expect(code).toContain('bp.enable_pullup(2, bp.wiring.la("OTHER"))  # LA2 i2c_sda')
  })

  it('runs the setup steps first, with the recorded settings', async () => {
    const seen: [string, Record<string, unknown> | undefined][] = []
    const call: BenchCall = async (tool, args) => {
      seen.push([tool, args])
      return tool === 'i2c_transfer' ? ok({ ack: true, rx_hex: 'c33c' }) : ok({})
    }
    const out = await runSequence(call, stepsFromRows(liveRows(), new Set([2, 3])))
    expect(seen.map((x) => x[0])).toEqual(['set_pull', 'i2c_open', 'i2c_transfer', 'i2c_transfer'])
    expect(seen[1][1]).toEqual({ sda: 2, scl: 1, hz: 100000, pullups: 'pod' })
    expect(out.map((o) => o.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
  })

  it.skipIf(!python)('the setup exports parse as Python', () => {
    const steps = stepsFromRows(liveRows(), new Set([2, 3]))
    expect(pyParse(sequenceToPytest({ name: 'setup', steps }, { names: LIVE_NAMES }))).toBe('ok')
  })

  it('the panel counts the selected steps and labels the setup', async () => {
    const steps = stepsFromRows(liveRows(), new Set([2, 3]))
    const store = memStore()
    wrap(<SequencesPanel store={store} call={async () => ok({})} selected={steps} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save 2 steps' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2. setup: I2C open SDA LA2 SCL LA1 100 kHz, pod pull-ups')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'live' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(store.rows).toHaveLength(1))
    expect(store.rows[0].version).toBe(2)
    expect(await screen.findByText('2 steps + setup')).toBeTruthy()
  })
})

describe('runSequence', () => {
  it('runs in order, flags a read that differs, and stops at an error', async () => {
    const seen: string[] = []
    const call: BenchCall = async (tool) => {
      seen.push(tool)
      if (tool === 'i2c_transfer') return ok({ ack: true, rx_hex: '59' })
      if (tool === 'gpio_write') return err('pin conflict: LA5 is in use by uart')
      return ok({})
    }
    const steps: SequenceStep[] = [
      { tool: 'i2c_open', args: {} },
      { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: 'd0', read: 1 }, expect: { ack: true, rx_hex: '58' } },
      { tool: 'gpio_write', args: { la: [5], level: 1 } },
      { tool: 'i2c_close', args: {} },
    ]
    const out = await runSequence(call, steps)
    expect(seen).toEqual(['i2c_open', 'i2c_transfer', 'gpio_write'])
    expect(out.map((o) => o.status)).toEqual(['ok', 'differs', 'error', 'skipped'])
    expect(out[1].note).toBe('read 59, recorded 58')
    expect(out[2].note).toContain('pin conflict')
  })

  it('stops when the user declines a step', async () => {
    const call: BenchCall = async (tool) => (tool === 'gpio_mode' ? { text: 'not run: you declined it', declined: true } : ok({}))
    const out = await runSequence(call, [{ tool: 'gpio_mode', args: {} }, { tool: 'gpio_write', args: {} }])
    expect(out.map((o) => o.status)).toEqual(['declined', 'skipped'])
  })
})

describe('httpSequenceStore', () => {
  it('talks to /benchpod/bus-sequences', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = []
    const store = httpSequenceStore(async (method, path, body) => {
      calls.push({ method, path, body })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (method === 'GET') return Response.json({ sequences: [{ id: 'a', name: 'n', version: 1, steps: [] }] })
      if (path.endsWith('/x')) return Response.json({ error: 'only the owner can change or delete a shared sequence' }, { status: 403 })
      return Response.json({ id: 'b', name: 'n', version: 1, steps: [] }, { status: 201 })
    })
    expect((await store.list())[0].id).toBe('a')
    await store.create({ name: 'n', steps: [] })
    await store.remove('a b')
    await expect(store.update('x', { name: 'm' })).rejects.toThrow('only the owner')
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /benchpod/bus-sequences', 'POST /benchpod/bus-sequences', 'DELETE /benchpod/bus-sequences/a%20b', 'PATCH /benchpod/bus-sequences/x'])
    expect(calls[1].body).toEqual({ version: SEQUENCE_VERSION, name: 'n', steps: [] })
  })
})

/** An in-memory store, like the desktop's local file. */
function memStore(seed: BusSequence[] = [], canShare = true): SequenceStore & { rows: BusSequence[] } {
  const rows = [...seed]
  let n = 0
  return {
    rows,
    canShare,
    where: 'Kept in memory.',
    list: async () => rows.map((r) => ({ ...r })),
    create: async (s: SequenceInput) => {
      const r = { id: `s${++n}`, version: 1, mine: true, shared: !!s.shared, ...s }
      rows.push(r)
      return r
    },
    update: async (id, s) => {
      const r = rows.find((x) => x.id === id)!
      Object.assign(r, s)
      return r
    },
    remove: async (id) => {
      rows.splice(
        rows.findIndex((x) => x.id === id),
        1,
      )
    },
  }
}

describe('SequencesPanel', () => {
  const selected: SequenceStep[] = [
    { tool: 'i2c_open', args: { hz: 400000 } },
    { tool: 'i2c_transfer', args: { addr: 0x76, write_hex: 'd0', read: 1 }, expect: { ack: true, rx_hex: '58' } },
  ]

  it('saves the selected rows under a name, shared when asked', async () => {
    const store = memStore()
    const clear = vi.fn()
    wrap(<SequencesPanel store={store} call={async () => ok({})} selected={selected} onClearSelection={clear} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save 2 steps' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'chip id' } })
    fireEvent.click(within(dialog).getByLabelText(/Share in my organization/))
    expect(within(dialog).getByText('2. I2C 0x76 W d0 R 1')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(store.rows).toHaveLength(1))
    expect(store.rows[0]).toMatchObject({ name: 'chip id', shared: true, version: SEQUENCE_VERSION, steps: selected })
    expect(clear).toHaveBeenCalled()
    expect(await screen.findByText('chip id')).toBeTruthy()
  })

  it('offers no sharing without an account', async () => {
    wrap(<SequencesPanel store={memStore([], false)} call={async () => ok({})} selected={selected} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save 2 steps' }))
    expect(screen.queryByLabelText(/Share in my organization/)).toBeNull()
  })

  it('runs a sequence through the BenchCall and shows each step', async () => {
    const seen: string[] = []
    const call: BenchCall = async (tool) => {
      seen.push(tool)
      return tool === 'i2c_transfer' ? ok({ ack: true, rx_hex: '60' }) : ok({})
    }
    wrap(<SequencesPanel store={memStore([{ id: 'a', name: 'chip id', version: 1, steps: selected, mine: true }])} call={call} selected={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }))
    const run = await screen.findByTestId('sequence-run')
    await waitFor(() => expect(within(run).getByText('read 60, recorded 58')).toBeTruthy())
    expect(seen).toEqual(['i2c_open', 'i2c_transfer'])
    expect(within(run).getByText('OK')).toBeTruthy()
    expect(within(run).getByText('differs')).toBeTruthy()
  })

  it('exports pytest with the wiring names', async () => {
    wrap(<SequencesPanel store={memStore([{ id: 'a', name: 'chip id', version: 1, steps: [{ tool: 'set_pull', args: { las: [1, 2], enabled: true } }], mine: true }])} call={async () => ok({})} selected={[]} names={NAMES} />)
    fireEvent.click(await screen.findByRole('button', { name: 'pytest' }))
    const code = (await screen.findByLabelText('pytest code')) as HTMLTextAreaElement
    expect(code.value).toContain('def test_chip_id(benchpod):')
    expect(code.value).toContain('bp.enable_pullup(1, 2)  # LA1 i2c_sda, LA2 i2c_scl')
  })

  it("another member's shared sequence is read-only: a copy, not rename or delete", async () => {
    const store = memStore([{ id: 'a', name: 'theirs', version: 1, steps: selected, mine: false, shared: true, owner: { id: 'u2', name: 'Sam' } }])
    wrap(<SequencesPanel store={store} call={async () => ok({})} selected={[]} />)
    expect(await screen.findByText('from Sam')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More for theirs' }))
    expect(await screen.findByText('Save a copy')).toBeTruthy()
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.queryByText('Rename')).toBeNull()
  })
})

describe('combinedSequenceStore', () => {
  it('keeps new ones local, puts shared ones in the account, and moves a local one when shared', async () => {
    const { combinedSequenceStore } = await import('./combinedStore')
    const local = memStore([], false)
    const account = memStore([{ id: 'x', name: 'theirs', version: 1, steps: [], mine: false, shared: true }])
    const store = combinedSequenceStore(local, account)
    expect(store.canShare).toBe(true)
    const a = await store.create({ name: 'mine', steps: [] })
    expect(a.id).toMatch(/^local:/)
    const b = await store.create({ name: 'team', steps: [], shared: true })
    expect(b.id).toMatch(/^account:/)
    expect((await store.list()).map((s) => s.id)).toEqual([a.id, 'account:x', b.id])
    const moved = await store.update(a.id, { shared: true })
    expect(moved.id).toMatch(/^account:/)
    expect(local.rows).toHaveLength(0)
    expect(account.rows.find((r) => r.name === 'mine')?.shared).toBe(true)
    await store.remove(b.id)
    expect(account.rows.map((r) => r.name)).toEqual(['theirs', 'mine'])
  })

  it('without an account: local only, no sharing', async () => {
    const { combinedSequenceStore } = await import('./combinedStore')
    const store = combinedSequenceStore(memStore([], false), null)
    expect(store.canShare).toBe(false)
    expect((await store.create({ name: 'n', steps: [], shared: true })).id).toMatch(/^local:/)
  })
})

describe('BusDashboard with sequences', () => {
  it('selects log rows and saves them as a sequence', async () => {
    const { BusDashboard } = await import('../BusDashboard')
    const call: BenchCall = async (tool) => {
      if (tool === 'wiring') return ok({ pins: [{ la: 1, wired_to: 'i2c_sda' }, { la: 2, wired_to: 'i2c_scl' }] })
      if (tool === 'la_pins') return ok({ pins: Array.from({ length: 14 }, (_, i) => ({ la: i + 1, function: 'none', pull: null, pull_on: false, in_use: false })), levels: null })
      if (tool === 'i2c_scan') return ok({ found: [0x76], found_hex: ['0x76'] })
      return ok({})
    }
    const store = memStore()
    wrap(<BusDashboard logKey={String(Math.random())} call={call} fetchCapture={(async () => ({ seq: 0 })) as never} sequences={store} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan' }))
    const box = await screen.findByLabelText('Select scan 0x08..0x77')
    fireEvent.click(box)
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 step' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'scan' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(store.rows).toHaveLength(1))
    expect(store.rows[0].steps[0]).toMatchObject({ tool: 'i2c_scan', expect: { found: [0x76] } })
  })
})
