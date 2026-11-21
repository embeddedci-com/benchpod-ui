// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { DecodeTable, decodeAnnotations, type DecodeResult } from './DecodeTables'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const wrap = (r: DecodeResult) => render(<MantineProvider><DecodeTable result={r} /></MantineProvider>)
const stat = (v: number) => ({ min: v, max: v, mean: v })

// Shapes as POST /analyzer/decode and the MCP capture resource return them.
const modbus: DecodeResult = {
  protocol: 'modbus',
  frames: [
    { index: 1, start_us: 10, end_us: 20, role: 'request', addr: 17, function: 3, function_name: 'READ_HOLDING_REGISTERS', start: 107, quantity: 3, summary: 'READ_HOLDING_REGISTERS 107 x3', data_hex: '00 6B 00 03', crc: '0x8776', ok: true },
    { index: 2, start_us: 30, end_us: 40, role: 'response', addr: 17, function: 3, function_name: 'READ_HOLDING_REGISTERS', values: [555, 0, 100], summary: 'READ_HOLDING_REGISTERS 107: 555 0 100', data_hex: '06 02 2B 00 00 00 64', crc: '0x0000', reply_to: 1, response_us: 10, ok: false, error: 'bad CRC' },
  ],
}
const can: DecodeResult = {
  protocol: 'can',
  frames: [
    { index: 1, start_us: 0, end_us: 100, kind: 'data', id: 0x123, id_hex: '0x123', extended: false, fd: true, brs: true, esi: false, dlc: 9, len: 12, data_hex: '01 02 03 04 05 06 07 08 09 0A 0B 0C', crc: '0x01ABCD', ack: true, stuff_bits: 3, ok: true },
    { index: 2, start_us: 200, end_us: 230, kind: 'error', id: 0xf0, id_hex: '0x0F0', extended: false, fd: false, brs: false, esi: false, dlc: 0, len: 0, data_hex: '', crc: '', ack: false, stuff_bits: 0, ok: false, error: 'stuff error, error frame' },
  ],
}
const pwm: DecodeResult = {
  protocol: 'pwm',
  channels: [
    { channel: 2, count: 2, freq_hz: stat(50), period_us: stat(20000), duty: stat(0.075), high_us: stat(1500), low_us: stat(18500), jitter_us: 0.5, glitches: 1, servo: { pulse_ms: stat(1.5), position_pct: stat(50) }, truncated: false,
      periods: [{ index: 1, start_us: 1000, period_us: 20000, freq_hz: 50, high_us: 1500, low_us: 18500, duty: 0.075 }] },
    { channel: 3, count: 0, level: 1, freq_hz: stat(0), period_us: stat(0), duty: stat(0), high_us: stat(0), low_us: stat(0), jitter_us: 0, glitches: 0, periods: [], truncated: false },
  ],
}
const onewire: DecodeResult = {
  protocol: 'onewire',
  transactions: [{ index: 1, start_us: 0, end_us: 900, reset: true, presence: true, overdrive: false, rom_command: 0x55, rom_command_name: 'MATCH_ROM', rom: '28 12 3B 5A 07 00 00 9F', rom_crc_ok: true, function: 'READ_SCRATCHPAD', bytes_hex: 'BE 58 01', detail: '21.5 °C', ok: true }],
}
const pmbus: DecodeResult = {
  protocol: 'pmbus',
  transactions: [{ index: 1, start_us: 0, end_us: 400, addr: 0x40, addr_hex: '0x40', kind: 'read word', command: 0x8b, command_name: 'READ_VOUT', data_hex: '00 06', value: '3 V', pec: 'ok', ok: true }],
}

describe('LA decoder tables', () => {
  it('Modbus: request, response with its reply time, errors', () => {
    wrap(modbus)
    expect(screen.getByText('READ_HOLDING_REGISTERS 107: 555 0 100')).toBeTruthy()
    expect(screen.getByText(/#1 \+10\.0 µs/)).toBeTruthy()
    expect(screen.getByText('error')).toBeTruthy()
  })
  it('CAN: FD BRS frame and an error frame', () => {
    wrap(can)
    expect(screen.getByText('FD BRS')).toBeTruthy()
    expect(screen.getByText('0x0F0')).toBeTruthy()
    expect(decodeAnnotations(can, { can: 4 }).map((a) => a.label)).toEqual(['0x123 [12]', 'error frame'])
  })
  it('PWM: a summary row per channel, periods on click', () => {
    wrap(pwm)
    expect(screen.getByText(/1\.500 ms, 50\.0 %/)).toBeTruthy()
    expect(screen.getByText(/No full period \(line high\)/)).toBeTruthy()
    fireEvent.click(screen.getByText('LA2'))
    expect(screen.getByText('20.000 ms')).toBeTruthy()
    expect(decodeAnnotations(pwm, {})).toEqual([])
  })
  it('1-Wire: ROM step, device and temperature', () => {
    wrap(onewire)
    expect(screen.getByText('28 12 3B 5A 07 00 00 9F')).toBeTruthy()
    expect(screen.getByText('READ_SCRATCHPAD: 21.5 °C')).toBeTruthy()
    expect(decodeAnnotations(onewire, { onewire: 6 })[0].label).toBe('MATCH_ROM READ_SCRATCHPAD')
  })
  it('PMBus: command name, value, PEC', () => {
    wrap(pmbus)
    expect(screen.getByText('READ_VOUT')).toBeTruthy()
    expect(screen.getByText('3 V')).toBeTruthy()
    expect(screen.getByText('PEC OK')).toBeTruthy()
  })
})
