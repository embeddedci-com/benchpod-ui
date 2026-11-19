import { describe, expect, it } from 'vitest'
import { canonicalPulls, coerceStoredWiring, effectiveWiring, LA_PULLS, pullDirections, validateWiring, WIRING_UNDEFINED, type Wiring } from './model'
import { assignPin, pinPullDirs, pinUseChoice, pinViews, pullSwitchLabel, setPinPull, signalUse, updateSignal } from './pins'

const apply = (w: Wiring, patch: Partial<Wiring>): Wiring => ({ ...w, ...patch })
const base: Wiring = { ...WIRING_UNDEFINED, la_mv: 3300, efuse: 1, i2c_addr: '0x76', uart_rx: 5, uart_tx: 4, i2c_sda: 1, i2c_scl: 2, signals: [{ name: 'READY', la: 9, direction: 'input', active_low: false, description: '' }] }

describe('pinViews', () => {
  it('shows each pin with what is on it and its pull resistor', () => {
    const v = pinViews({ ...base, pulls: [1, 2] })
    expect(v).toHaveLength(14)
    expect(v[0]).toMatchObject({ la: 1, kind: 'i2c', short: 'I2C SDA', pullOn: true })
    expect(v[4]).toMatchObject({ la: 5, kind: 'uart', short: 'UART RX', pullOn: false })
    expect(v[8]).toMatchObject({ la: 9, kind: 'signal', short: 'READY', pullOn: false })
    expect(v[2]).toMatchObject({ la: 3, kind: null, short: 'free' })
    expect(pinUseChoice(v[8])).toBe('signal')
    expect(pinUseChoice(v[2])).toBe('none')
  })
  it('lists both users of a pin wired twice', () => {
    const v = pinViews({ ...base, spi_cs: 5 })
    expect(v[4].users.map((u) => u.label)).toEqual(['UART RX', 'SPI CS'])
  })
})

describe('assignPin', () => {
  it('moves a role to the new pin and frees the old one', () => {
    const w = apply(base, assignPin(base, 7, 'uart_rx'))
    expect(w.uart_rx).toBe(7)
    expect(pinViews(w)[4].short).toBe('free')
    expect(validateWiring(w as unknown as Record<string, unknown>).errors).toEqual([])
  })
  it('replaces what was on the pin', () => {
    const w = apply(base, assignPin(base, 9, 'spi_cs'))
    expect(w.spi_cs).toBe(9)
    expect(w.signals).toEqual([])
  })
  it('frees a pin', () => {
    const w = apply(base, assignPin(base, 1, 'none'))
    expect(w.i2c_sda).toBeNull()
  })
  it('adds a signal with a free name that the pod reads', () => {
    const w = apply(base, assignPin(base, 10, 'signal'))
    expect(w.signals[1]).toEqual({ name: 'SIGNAL1', la: 10, direction: 'input', active_low: false, description: '' })
  })
  it('changes nothing when the use stays', () => {
    expect(assignPin(base, 5, 'uart_rx')).toEqual({})
    expect(assignPin(base, 9, 'signal')).toEqual({})
  })
  it('resolves a conflict by keeping one use', () => {
    const w0 = { ...base, spi_cs: 5 }
    const w = apply(w0, assignPin(w0, 5, 'uart_rx'))
    expect(w.uart_rx).toBe(5)
    expect(w.spi_cs).toBeNull()
  })
  it('drops a removed signal\'s older direction override', () => {
    const w0 = { ...base, dut_dirs: { READY: 'bidir' as const } }
    expect(apply(w0, assignPin(w0, 9, 'none')).dut_dirs).toEqual({})
  })
})

describe('updateSignal', () => {
  it('sets what the pod does with it', () => {
    const w = apply(base, updateSignal(base, 0, { use: 'drives' }))
    expect(w.signals[0].direction).toBe('output')
    expect(signalUse(w.signals[0])).toBe('drives')
    expect(signalUse({ direction: 'bidir' })).toBe('both')
  })
  it('renames and keeps an older override under the new name', () => {
    const w0 = { ...base, dut_dirs: { READY: 'bidir' as const } }
    const w = apply(w0, updateSignal(w0, 0, { name: 'DONE' }))
    expect(w.signals[0].name).toBe('DONE')
    expect(w.dut_dirs).toEqual({ DONE: 'bidir' })
  })
  it('drops the older override once the pod\'s use is chosen', () => {
    const w0 = { ...base, dut_dirs: { READY: 'bidir' as const } }
    expect(apply(w0, updateSignal(w0, 0, { use: 'reads' })).dut_dirs).toEqual({})
  })
})

describe('pulls', () => {
  it('switches a pin\'s pull resistor on and off', () => {
    let w = apply(base, setPinPull(base, 2, true))
    w = apply(w, setPinPull(w, 1, true))
    expect(w.pulls).toEqual([1, 2])
    expect(apply(w, setPinPull(w, 1, false)).pulls).toEqual([2])
    expect(setPinPull(w, 9, true)).toEqual({})
  })
  it('labels the resistor by its direction', () => {
    const v = pinViews(base)
    expect(pullSwitchLabel(v[0].pull)).toBe('Pull-up (4.7k)')
    expect(pullSwitchLabel(v[6].pull)).toBe('Pull-down (10k)')
    expect(pullSwitchLabel(v[9].pull)).toBeNull()
  })
  it('stores and checks the pulls key', () => {
    expect(coerceStoredWiring({ pulls: [2, 1, 2, 12] }).pulls).toEqual([1, 2])
    expect(effectiveWiring({ version: 2 }).pulls).toBeNull()
    expect(validateWiring({ pulls: [1, 9] }).errors.map((e) => e.field)).toEqual(['pulls[1]'])
    expect(validateWiring({ pulls: 'on' }).errors.map((e) => e.field)).toEqual(['pulls'])
    expect(validateWiring({ version: 2, la_mv: 1800, pulls: [1] }).warnings.map((e) => e.field)).toContain('pulls')
  })
  it('pulls by direction, written as the list while every pull is its own direction', () => {
    let w = apply(base, setPinPull(base, 2, 'up'))
    w = apply(w, setPinPull(w, 7, 'down'))
    expect(w.pulls).toEqual([2, 7])
    expect(pinViews(w)[6].pullDir).toBe('down')
    expect(pinViews(w)[1].pullDir).toBe('up')
    expect(pinViews(w)[0].pullDir).toBeNull()
    expect(apply(w, setPinPull(w, 7, null)).pulls).toEqual([2])
    // a direction a channel does not have on today's boards is kept as a map (a later board)
    expect(canonicalPulls(new Map([[1, 'up'], [7, 'up']]))).toEqual({ '1': 'up', '7': 'up' })
    expect(canonicalPulls(new Map([[8, 'down'], [1, 'up']]))).toEqual([1, 8])
  })
  it('reads the map form and checks it', () => {
    expect(pullDirections([8, 1])).toEqual(new Map([[1, 'up'], [8, 'down']]))
    expect(pullDirections({ '2': 'up', '8': 'down' })).toEqual(new Map([[2, 'up'], [8, 'down']]))
    expect(pullDirections(null).size).toBe(0)
    expect(coerceStoredWiring({ pulls: { '2': 'up', '8': 'down' } }).pulls).toEqual([2, 8])
    expect(coerceStoredWiring({ pulls: { '7': 'up', '1': 'up' } }).pulls).toEqual([1])   // LA7 can't pull up today
    expect(validateWiring({ pulls: { '1': 'up', '8': 'down' } }).errors).toEqual([])
    expect(validateWiring({ pulls: { '7': 'up' } }).errors).toEqual([{ field: 'pulls.7', message: 'LA7 supports pull-down only on this board' }])
    expect(validateWiring({ pulls: { '9': 'up' } }).errors.map((e) => e.field)).toEqual(['pulls.9'])
    expect(validateWiring({ pulls: { '1': 'on' } }).errors.map((e) => e.field)).toEqual(['pulls.1'])
    expect(validateWiring({ version: 2, i2c_sda: 7, pulls: { '7': 'down' } }).warnings.map((e) => e.field)).toEqual(['i2c_sda'])
  })
  it('takes the directions a pin can pull from the pod when it says', () => {
    expect(pinPullDirs(LA_PULLS[0])).toEqual(['up'])
    expect(pinPullDirs(LA_PULLS[0], { pull: 'up', pull_dirs: ['up', 'down'] })).toEqual(['up', 'down'])
    expect(pinPullDirs(LA_PULLS[6], { pull: 'down' })).toEqual(['down'])   // older firmware
    expect(pinPullDirs(LA_PULLS[9], { pull: null })).toEqual([])
    expect(pullSwitchLabel(LA_PULLS[0], ['up', 'down'])).toBe('Pull-up/down (4.7k)')
  })
  it('warns about a pull-down under I2C only while it is on', () => {
    expect(validateWiring({ version: 2, i2c_sda: 7, pulls: [] }).warnings).toEqual([])
    expect(validateWiring({ version: 2, i2c_sda: 7, pulls: [7] }).warnings.map((e) => e.field)).toEqual(['i2c_sda'])
  })
})
