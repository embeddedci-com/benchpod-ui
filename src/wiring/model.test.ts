import { describe, expect, it } from 'vitest'
import {
  coerceStoredWiring,
  effectiveWiring,
  firstFreeLaChannel,
  LA_PULLS,
  pullLabel,
  laChannelLabel,
  laChannelMap,
  validateWiring,
  WIRING_DEFAULTS,
  wiringFieldErrors,
  wiringProfileJson,
} from './model'

// The wiring profile (schema v1) helpers, as the web app tests them.

const fields = (issues: { field: string }[]) => issues.map((i) => i.field)

describe('effectiveWiring', () => {
  it('takes the defaults for absent keys', () => {
    expect(effectiveWiring({})).toEqual(WIRING_DEFAULTS)
    expect(WIRING_DEFAULTS).toMatchObject({
      version: 1,
      la_mv: 3300,
      efuse: 1,
      uart_rx: 5,
      uart_tx: 4,
      uart_baud: 115200,
      i2c_sda: 1,
      i2c_scl: 2,
      i2c_addr: '0x76',
      swd_swclk: 11,
      swd_swdio: 12,
      swd_nreset: false,
      swd_target: '',
      spi_sclk: null,
      spi_mosi: null,
      spi_miso: null,
      spi_cs: null,
      signals: [],
    })
  })

  it('treats a null pin as "not wired", overriding the default', () => {
    const w = effectiveWiring({ uart_rx: null, i2c_sda: 7 })
    expect(w.uart_rx).toBeNull()
    expect(w.i2c_sda).toBe(7)
    expect(w.uart_tx).toBe(4)
  })

  it('drops unknown keys, malformed values and null on non-pin keys', () => {
    const w = effectiveWiring({ bogus: 1, uart_baud: 'fast', la_mv: null, uart_tx: 15, i2c_addr: 0x76 })
    expect(w).toEqual(WIRING_DEFAULTS)
    expect(coerceStoredWiring({ bogus: 1, uart_tx: 15, loop_input_unit: 'mA' })).toEqual({ loop_input_unit: 'mA' })
  })

  it('keeps the control-loop keys and fills signal defaults', () => {
    const w = effectiveWiring({ loop_input_unit: 'mA', signals: [{ name: 'TRIGGER', la: 9 }] })
    expect(w.loop_input_unit).toBe('mA')
    expect(w.signals).toEqual([{ name: 'TRIGGER', la: 9, direction: 'input', active_low: false, description: '' }])
  })
})

describe('validateWiring', () => {
  it('accepts an empty object and the full defaults', () => {
    expect(validateWiring({})).toEqual({ errors: [], warnings: [] })
    expect(validateWiring(WIRING_DEFAULTS as unknown as Record<string, unknown>)).toEqual({ errors: [], warnings: [] })
  })

  it('rejects unknown keys and wrong types/ranges', () => {
    const { errors } = validateWiring({
      colour: 'red',
      version: 2,
      la_mv: 2500,
      efuse: 3,
      uart_rx: 0,
      uart_tx: 1.5,
      uart_baud: 299,
      i2c_addr: '0x78',
      swd_nreset: 'yes',
      swd_target: 'x'.repeat(129),
      loop_input_min: 'low',
    })
    expect(fields(errors).sort()).toEqual(
      [
        'colour',
        'version',
        'la_mv',
        'efuse',
        'uart_rx',
        'uart_tx',
        'uart_baud',
        'i2c_addr',
        'swd_nreset',
        'swd_target',
        'loop_input_min',
      ].sort(),
    )
    expect(errors.find((e) => e.field === 'uart_rx')?.message).toBe("uart_rx must be an LA channel 1-14, or null when it isn't wired")
  })

  it('checks the I2C address is hex 0x03..0x77 and the baud range', () => {
    expect(fields(validateWiring({ i2c_addr: '0x03' }).errors)).toEqual([])
    expect(fields(validateWiring({ i2c_addr: '0x77' }).errors)).toEqual([])
    expect(fields(validateWiring({ i2c_addr: '0x02' }).errors)).toEqual(['i2c_addr'])
    expect(fields(validateWiring({ i2c_addr: '118' }).errors)).toEqual(['i2c_addr'])
    expect(fields(validateWiring({ uart_baud: 300 }).errors)).toEqual([])
    expect(fields(validateWiring({ uart_baud: 4000000 }).errors)).toEqual([])
    expect(fields(validateWiring({ uart_baud: 4000001 }).errors)).toEqual(['uart_baud'])
  })

  it('reports a channel shared by two roles, naming both users', () => {
    const { errors } = validateWiring({ i2c_sda: 4 })
    expect(errors).toEqual([{ field: 'i2c_sda', message: 'LA4 is used by both uart_tx and i2c_sda' }])
  })

  it('counts defaults as users, so "not wired" clears a conflict', () => {
    expect(validateWiring({ uart_tx: 1 }).errors).toEqual([{ field: 'i2c_sda', message: 'LA1 is used by both uart_tx and i2c_sda' }])
    expect(validateWiring({ uart_tx: 1, i2c_sda: null }).errors).toEqual([])
  })

  it('reports a signal sharing a channel with a role under the signal field', () => {
    const { errors } = validateWiring({ signals: [{ name: 'TRIGGER', la: 11 }] })
    expect(errors).toEqual([{ field: 'signals[0].la', message: 'LA11 is used by both swd_swclk and TRIGGER' }])
  })

  it("doesn't report a phantom conflict for a value that already failed its range check", () => {
    const { errors } = validateWiring({ i2c_sda: 99, uart_tx: 1 })
    expect(fields(errors)).toEqual(['i2c_sda'])
  })

  it('validates signal entries', () => {
    const sig = (over: Record<string, unknown>) => ({ name: 'OK', la: 3, ...over })
    const check = (s: Record<string, unknown>) => fields(validateWiring({ signals: [s] }).errors)
    expect(check(sig({}))).toEqual([])
    expect(check(sig({ name: '9lives' }))).toEqual(['signals[0].name'])
    expect(check(sig({ name: 'has-dash' }))).toEqual(['signals[0].name'])
    expect(check(sig({ name: 'A'.repeat(33) }))).toEqual(['signals[0].name'])
    expect(check(sig({ name: 'uart_rx' }))).toEqual(['signals[0].name'])
    expect(check(sig({ la: 15 }))).toEqual(['signals[0].la'])
    expect(check(sig({ direction: 'in' }))).toEqual(['signals[0].direction'])
    expect(check(sig({ active_low: 1 }))).toEqual(['signals[0].active_low'])
    expect(check(sig({ description: 'd'.repeat(121) }))).toEqual(['signals[0].description'])

    const dup = validateWiring({ signals: [sig({ name: 'Trigger' }), sig({ name: 'TRIGGER', la: 6 })] })
    expect(dup.errors).toEqual([{ field: 'signals[1].name', message: 'signals[1].name "TRIGGER" is already used by signals[0]' }])

    const many = Array.from({ length: 15 }, (_, i) => ({ name: `S${i}`, la: (i % 14) + 1 }))
    expect(fields(validateWiring({ signals: many }).errors)).toContain('signals')
  })

  it('warns (without erroring) about pull resistors that fight the bus', () => {
    const w = validateWiring({ i2c_sda: 9, i2c_scl: 7, uart_rx: 8, uart_tx: 3, signals: [] })
    expect(w.errors).toEqual([])
    expect(w.warnings).toEqual([
      { field: 'i2c_sda', message: 'no pod pull-up on LA9-LA14; the bus needs external pull-ups' },
      { field: 'i2c_scl', message: 'LA7/LA8 have 10k pull-downs; keep them disabled on an open-drain bus' },
      { field: 'uart_rx', message: 'LA7/LA8 have pull-downs; the UART idles high — keep the pull disabled' },
    ])
  })
})

describe('laChannelMap / laChannelLabel', () => {
  it('maps the defaults onto LA1..LA14 with the fixed pull resistors', () => {
    const map = laChannelMap(WIRING_DEFAULTS)
    expect(map).toHaveLength(14)
    expect(map[0].users.map((u) => u.id)).toEqual(['i2c_sda'])
    expect(map[3].users.map((u) => u.id)).toEqual(['uart_tx'])
    expect(map[10].users.map((u) => u.label)).toEqual(['SWCLK'])
    expect(map[2].users).toEqual([])
    expect(map.map((c) => c.pull)).toEqual(LA_PULLS)
    expect(LA_PULLS.map((p) => `${p.dir}:${p.ohms}`)).toEqual([
      'up:4.7k',
      'up:4.7k',
      'up:2.2k',
      'up:2.2k',
      'up:10k',
      'up:10k',
      'down:10k',
      'down:10k',
      'null:null',
      'null:null',
      'null:null',
      'null:null',
      'null:null',
      'null:null',
    ])
  })

  it('flags conflicts and per-channel warnings', () => {
    const w = effectiveWiring({ i2c_sda: 4, i2c_scl: 9 })
    const map = laChannelMap(w)
    expect(map[3].conflict).toBe(true)
    expect(map[3].users.map((u) => u.id)).toEqual(['uart_tx', 'i2c_sda'])
    expect(map[8].warnings).toEqual(['no pod pull-up on LA9-LA14; the bus needs external pull-ups'])
    expect(map[0].conflict).toBe(false)
  })

  it('labels a channel with its role or signal name', () => {
    const w = effectiveWiring({ signals: [{ name: 'TRIGGER', la: 9 }] })
    expect(laChannelLabel(w, 9)).toBe('LA9 · TRIGGER')
    expect(laChannelLabel(w, 1)).toBe('LA1 · I2C SDA')
    expect(laChannelLabel(w, 3)).toBe('LA3')
  })

  it('highlights every user of a conflicting channel inline', () => {
    const w = effectiveWiring({ i2c_sda: 4 })
    const errs = wiringFieldErrors(w, validateWiring({ i2c_sda: 4 }).errors)
    expect(errs.get('i2c_sda')).toBe('LA4 is used by both uart_tx and i2c_sda')
    expect(errs.get('uart_tx')).toBe('LA4 is also used by i2c_sda')
  })

  it('finds the first free channel for a new signal', () => {
    expect(firstFreeLaChannel(WIRING_DEFAULTS)).toBe(3)
    const full = effectiveWiring({
      signals: [3, 6, 7, 8, 9, 10, 13, 14].map((la) => ({ name: `S${la}`, la })),
    })
    expect(firstFreeLaChannel(full)).toBeNull()
  })

  it('exports the profile without the control-loop keys', () => {
    const json = wiringProfileJson(WIRING_DEFAULTS)
    expect(Object.keys(json).some((k) => k.startsWith('loop_input_'))).toBe(false)
    expect(json.swd_swclk).toBe(11)
  })
})

describe('pullLabel', () => {
  it('names each channel\'s resistor: up on LA1-LA6, down on LA7-LA8, none on LA9-LA14', () => {
    expect(LA_PULLS).toHaveLength(14)
    expect(LA_PULLS.map(pullLabel)).toEqual([
      'pull-up 4.7k', 'pull-up 4.7k', 'pull-up 2.2k', 'pull-up 2.2k', 'pull-up 10k', 'pull-up 10k',
      'pull-down 10k', 'pull-down 10k', 'none', 'none', 'none', 'none', 'none', 'none',
    ])
  })
})
