// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { DecodeTable, decodeAnnotations, usbChip, type UsbDecode } from './DecodeTables'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const setup = { name: 'SET_ADDRESS', summary: 'SET_ADDRESS 5', direction: 'out', type: 'standard', recipient: 'device', w_length: 0 }

// The shape POST /analyzer/decode and the MCP capture resource return for protocol usb.
const usb: UsbDecode = {
  protocol: 'usb',
  speed: 'full',
  sof_count: 1,
  error_count: 1,
  packets: [
    { index: 1, start_us: 0, end_us: 50, kind: 'reset', ok: true },
    { index: 2, start_us: 60, end_us: 62, kind: 'packet', pid: 'SOF', frame: 100, crc: '0x0A', ok: true },
    { index: 3, start_us: 70, end_us: 72, kind: 'packet', pid: 'SETUP', addr: 0, endpoint: 0, crc: '0x02', ok: true },
    { index: 4, start_us: 73, end_us: 80, kind: 'packet', pid: 'DATA0', data_hex: '00 05 05 00 00 00 00 00', crc: '0x1234', ok: false, error: 'bad CRC16' },
  ],
  transactions: [
    { index: 1, start_us: 0, end_us: 50, type: 'RESET', addr: 0, endpoint: 0, data_len: 0, count: 1, packets: [1], ok: true },
    { index: 2, start_us: 100, end_us: 110, type: 'IN', addr: 5, endpoint: 1, data_len: 0, handshake: 'NAK', count: 3, packets: [5, 6], ok: true },
  ],
  transfers: [
    { index: 1, start_us: 70, end_us: 90, addr: 0, endpoint: 0, request: 'SET_ADDRESS 5', setup, data_len: 0, status: 'OK', ok: true },
  ],
}

const wrap = (el: React.ReactNode) => render(<MantineProvider>{el}</MantineProvider>)

describe('USB decode table', () => {
  it('opens on the transfers, then shows transactions and packets', () => {
    wrap(<DecodeTable result={usb} />)
    expect(screen.getByText('SET_ADDRESS 5')).toBeTruthy()
    fireEvent.click(screen.getByText('Transactions 2'))
    expect(screen.getByText('×3')).toBeTruthy()
    expect(screen.getByText('Reset')).toBeTruthy()
    fireEvent.click(screen.getByText('Packets 4'))
    expect(screen.queryByText('frame 100')).toBeNull() // SOF hidden until switched on
    expect(screen.getByText('0x1234')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('SOF'))
    expect(screen.getByText('frame 100')).toBeTruthy()
  })

  it('puts a chip per packet on D+', () => {
    const chips = decodeAnnotations(usb, { dp: 3 })
    expect(chips.map((c) => c.label)).toEqual(['Reset', 'SOF 100', 'SETUP 0.0', 'DATA0 [8] !'])
    expect(chips.every((c) => c.ch === 3)).toBe(true)
    expect(decodeAnnotations(usb, {})).toEqual([])
    expect(usbChip({ index: 1, start_us: 0, end_us: 1, kind: 'packet', pid: 'ACK', ok: true })).toBe('ACK')
  })
})
