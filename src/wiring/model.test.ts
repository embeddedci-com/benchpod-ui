import { describe, expect, it } from 'vitest'
import {
  supplyLabel,
  legacyEfuse,
  coerceStoredWiring,
  effectiveWiring,
  firstFreeLaChannel,
  LA_PULLS,
  pullLabel,
  laChannelLabel,
  laChannelMap,
  pinDutDirs,
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
      supply: '5v',
      uart_rx: 5,
      uart_tx: 4,
      uart_baud: 115200,
      uart_parity: 'none',
      uart_stop_bits: 1,
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

  it('takes the four supplies, and the legacy efuse 1 and 2', () => {
    for (const supply of ['5v', 'external', '3v3', '1v8']) expect(validateWiring({ supply }).errors).toEqual([])
    expect(fields(validateWiring({ supply: 'j1_3v3' }).errors)).toEqual(['supply'])
    expect(fields(validateWiring({ supply: 'internal' }).errors)).toEqual(['supply'])
    expect(validateWiring({ efuse: 2 }).errors).toEqual([])
    expect(fields(validateWiring({ efuse: 3 }).errors)).toEqual(['efuse'])
    expect(validateWiring({ supply: '5v', efuse: 1 }).errors).toEqual([])
    expect(fields(validateWiring({ supply: 'external', efuse: 1 }).errors)).toEqual(['supply'])
    expect(supplyLabel('1v8')).toBe('1.8 V')
    expect(supplyLabel('external')).toBe('external supply')
    expect(supplyLabel(1)).toBe('5 V')
    expect(supplyLabel('')).toBe('not set')
  })

  it('reads the legacy efuse key as the supply, and writes both for 5v and external', () => {
    expect(effectiveWiring({ efuse: 2 }).supply).toBe('external')
    expect(effectiveWiring({ version: 2, efuse: 1 }).supply).toBe('5v')
    expect(effectiveWiring({ supply: '3v3', efuse: 1 }).supply).toBe('3v3')
    expect(effectiveWiring({ version: 2, efuse: 'internal' }).supply).toBe('')
    expect(legacyEfuse('external')).toBe(2)
    expect(wiringProfileJson({ ...WIRING_DEFAULTS, supply: 'external' })).toMatchObject({ supply: 'external', efuse: 2 })
    expect(wiringProfileJson({ ...WIRING_DEFAULTS, supply: '1v8' })).not.toHaveProperty('efuse')
  })

  it('rejects unknown keys and wrong types/ranges', () => {
    const { errors } = validateWiring({
      colour: 'red',
      version: 3,
      la_mv: 2500,
      supply: 'j1_3v3',
      uart_rx: 0,
      uart_tx: 1.5,
      uart_baud: 299,
      uart_parity: 'mark',
      uart_stop_bits: 3,
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
        'supply',
        'uart_rx',
        'uart_tx',
        'uart_baud',
        'uart_parity',
        'uart_stop_bits',
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

describe('version 2 profiles', () => {
  it('leave undefined what they do not set', () => {
    const w = effectiveWiring({ version: 2, uart_rx: 7 })
    expect(w.version).toBe(2)
    expect(w.uart_rx).toBe(7)
    expect([w.uart_tx, w.swd_swclk, w.swd_swdio, w.i2c_sda, w.i2c_scl]).toEqual([null, null, null, null, null])
    expect([w.la_mv, w.supply, w.i2c_addr]).toEqual([0, '', ''])
    expect(w.uart_baud).toBe(115200)
  })
  it('keep version 1 meaning the reference bench', () => {
    const w = effectiveWiring({ uart_rx: 7 })
    expect(w.swd_swclk).toBe(11)
    expect(w.la_mv).toBe(3300)
  })
})

describe('JTAG pins', () => {
  const jtag = { version: 2, jtag_tck: 3, jtag_tms: 4, jtag_tdi: 5, jtag_tdo: 6, jtag_trst: 7 }

  it('accepts the five JTAG roles, and nothing is wired by default', () => {
    expect(validateWiring(jtag).errors).toEqual([])
    const w = effectiveWiring({})
    expect([w.jtag_tck, w.jtag_tms, w.jtag_tdi, w.jtag_tdo, w.jtag_trst]).toEqual([null, null, null, null, null])
    expect(effectiveWiring(jtag).jtag_tdo).toBe(6)
  })
  it('checks the range like the other pins', () => {
    expect(validateWiring({ jtag_tdi: 15 }).errors).toEqual([{ field: 'jtag_tdi', message: 'jtag_tdi must be an LA channel 1-14, or null when it isn\'t wired' }])
  })
  it('lets TCK share SWCLK and TMS share SWDIO, and no other pair', () => {
    expect(validateWiring({ version: 2, swd_swclk: 11, swd_swdio: 12, jtag_tck: 11, jtag_tms: 12, jtag_tdi: 3, jtag_tdo: 4 }).errors).toEqual([])
    expect(validateWiring({ version: 2, swd_swclk: 11, jtag_tdi: 11 }).errors).toEqual([{ field: 'jtag_tdi', message: 'LA11 is used by both swd_swclk and jtag_tdi' }])
    expect(validateWiring({ version: 2, swd_swdio: 12, jtag_tck: 12 }).errors).toEqual([{ field: 'jtag_tck', message: 'LA12 is used by both swd_swdio and jtag_tck' }])
    expect(validateWiring({ version: 2, jtag_tdi: 3, jtag_tdo: 3 }).errors).toEqual([{ field: 'jtag_tdo', message: 'LA3 is used by both jtag_tdi and jtag_tdo' }])
  })
  it('gives each its default direction, and both ways to a pin shared by SWDIO and TMS', () => {
    const w = effectiveWiring({ version: 2, swd_swclk: 11, swd_swdio: 12, jtag_tck: 11, jtag_tms: 12, jtag_tdi: 3, jtag_tdo: 4, jtag_trst: 5 })
    expect(pinDutDirs(w)).toMatchObject({ 11: 'dut_input', 12: 'bidir', 3: 'dut_input', 4: 'dut_output', 5: 'dut_input' })
    const ch = laChannelMap(w)
    expect(ch[10].conflict).toBe(false)
    expect(ch[11].users.map((u) => u.label)).toEqual(['SWDIO', 'TMS'])
  })

  it('accepts debug_port swd, jtag or null and rejects anything else', () => {
    for (const v of ['swd', 'jtag', null]) expect(validateWiring({ debug_port: v }).errors).toEqual([])
    expect(validateWiring({ debug_port: 'swo' }).errors.map((e) => e.field)).toEqual(['debug_port'])
    expect(WIRING_DEFAULTS.debug_port).toBeNull()
    expect(coerceStoredWiring({ debug_port: 'jtag' }).debug_port).toBe('jtag')
    expect(coerceStoredWiring({ debug_port: 'x' }).debug_port).toBeUndefined()
  })
})

describe('monitors', () => {
  const ok = { chip: 'ina226', addr: 64, shunt_ohm: 10 }
  const check = (m: unknown) => validateWiring({ monitors: [m] }).errors
  it('defaults to none, is left out of the profile JSON when empty and kept when set', () => {
    expect(WIRING_DEFAULTS.monitors).toEqual([])
    expect(effectiveWiring({}).monitors).toEqual([])
    expect(wiringProfileJson(effectiveWiring({})).monitors).toBeUndefined()
    expect(wiringProfileJson(effectiveWiring({ monitors: [ok] })).monitors).toEqual([ok])
    expect(validateWiring({ monitors: [] }).errors).toEqual([])
  })
  it('keeps a stored entry as written and drops what is not a list', () => {
    const full = { chip: 'ina3221', addr: 67, shunt_ohm: 0.1, name: 'dut', channel: 2, sda: 13, scl: 14, averaging: 16, conversion_time: 0.0011, max_current: 0.001 }
    expect(coerceStoredWiring({ monitors: [full, 'x'] }).monitors).toEqual([full])
    expect(coerceStoredWiring({ monitors: 'x' }).monitors).toBeUndefined()
    expect(validateWiring({ monitors: [{ ...full, sda: undefined, scl: undefined }] }).errors).toEqual([])
  })
  it('accepts the schema examples', () => {
    expect(check(ok)).toEqual([])
    expect(check({ chip: 'ina260', addr: 65 })).toEqual([])
    expect(check({ chip: 'ina260', addr: 65, shunt_ohm: 0.002 })).toEqual([])
    expect(check({ chip: 'ina219', addr: 79, shunt_ohm: 0.1, averaging: 2 })).toEqual([])
    expect(check({ chip: 'ina3221', addr: 67, shunt_ohm: 1, channel: 3 })).toEqual([])
  })
  it('flags each bad field on monitors[i].field', () => {
    const cases: [unknown, string][] = [
      [5, 'monitors[0]'],
      [{ addr: 64, shunt_ohm: 1 }, 'monitors[0].chip'],
      [{ ...ok, chip: 'ina999' }, 'monitors[0].chip'],
      [{ chip: 'ina226', shunt_ohm: 1 }, 'monitors[0].addr'],
      [{ ...ok, addr: 63 }, 'monitors[0].addr'],
      [{ ...ok, addr: 80 }, 'monitors[0].addr'],
      [{ ...ok, addr: '0x40' }, 'monitors[0].addr'],
      [{ chip: 'ina3221', addr: 68, shunt_ohm: 1 }, 'monitors[0].addr'],
      [{ chip: 'ina226', addr: 64 }, 'monitors[0].shunt_ohm'],
      [{ ...ok, shunt_ohm: 0 }, 'monitors[0].shunt_ohm'],
      [{ ...ok, shunt_ohm: 2e6 }, 'monitors[0].shunt_ohm'],
      [{ chip: 'ina260', addr: 64, shunt_ohm: 0.1 }, 'monitors[0].shunt_ohm'],
      [{ ...ok, channel: 1 }, 'monitors[0].channel'],
      [{ chip: 'ina3221', addr: 64, shunt_ohm: 1, channel: 4 }, 'monitors[0].channel'],
      [{ ...ok, name: '1dut' }, 'monitors[0].name'],
      [{ ...ok, name: 'a'.repeat(33) }, 'monitors[0].name'],
      [{ ...ok, sda: 15 }, 'monitors[0].sda'],
      [{ ...ok, sda: 3, scl: 3 }, 'monitors[0].scl'],
      [{ ...ok, averaging: 2 }, 'monitors[0].averaging'],
      [{ chip: 'ina219', addr: 64, shunt_ohm: 1, averaging: 1024 }, 'monitors[0].averaging'],
      [{ ...ok, conversion_time: 0 }, 'monitors[0].conversion_time'],
      [{ ...ok, conversion_time: 0.02 }, 'monitors[0].conversion_time'],
      [{ ...ok, max_current: -1 }, 'monitors[0].max_current'],
      [{ ...ok, gain: 2 }, 'monitors[0].gain'],
    ]
    for (const [m, field] of cases) expect(fields(check(m)), JSON.stringify(m)).toEqual([field])
    expect(validateWiring({ monitors: { chip: 'ina226' } }).errors.map((e) => e.field)).toEqual(['monitors'])
    expect(validateWiring({ monitors: Array(9).fill(ok) }).errors.map((e) => e.field)).toEqual(['monitors'])
  })
  it('wants unique addresses (per channel for the ina3221) and names, and one pair of pins', () => {
    expect(fields(validateWiring({ monitors: [ok, { ...ok, name: 'b' }] }).errors)).toEqual(['monitors[1].addr'])
    expect(validateWiring({ monitors: [{ chip: 'ina3221', addr: 64, shunt_ohm: 1 }, { chip: 'ina3221', addr: 64, shunt_ohm: 1, channel: 2 }] }).errors).toEqual([])
    expect(fields(validateWiring({ monitors: [{ ...ok, name: 'Dut' }, { ...ok, addr: 65, name: 'dut' }] }).errors)).toEqual(['monitors[1].name'])
    expect(fields(validateWiring({ monitors: [{ ...ok, name: 'ina226@0x41' }, { ...ok, addr: 65 }] }).errors)).toEqual(['monitors[1].name'])
    expect(fields(validateWiring({ monitors: [ok, { ...ok, addr: 65, sda: 13, scl: 14 }] }).errors)).toEqual(['monitors'])
    expect(validateWiring({ monitors: [{ ...ok, sda: 13, scl: 14 }, { ...ok, addr: 65, sda: 13, scl: 14 }] }).errors).toEqual([])
  })
  it('needs pins when the profile has no I2C pins to default to', () => {
    expect(fields(validateWiring({ i2c_sda: null, monitors: [ok] }).errors)).toEqual(['monitors[0].sda'])
    expect(validateWiring({ i2c_sda: null, i2c_scl: null, monitors: [{ ...ok, sda: 13, scl: 14 }] }).errors).toEqual([])
  })
})
