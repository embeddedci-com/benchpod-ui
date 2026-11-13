// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { BenchCall, BenchResult } from '../bench/benchCall'
import { decodeValue, encodeValue, i2cRegHex, parseDevice, spiReadHex, spiWriteHex, type DeviceDef } from './device'
import { I2cTab } from './I2cTab'
import { SpiTab } from './SpiTab'

const files = import.meta.glob('../sensors/testdata/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const yaml = (name: string) => files[`../sensors/testdata/${name}.yaml`]

// The library's SPI accelerometer, cut down to its bus block and a few registers.
const LIS3DH = `format: 1
kind: spi
name: lis3dh
label: "Accelerometer (SPI)"
spi:
  mode: 3
  read_bit: { bit: 7, value: 1 }
  increment_bit: { bit: 6, value: 1 }
  address_mask: 0x3F
registers:
  - { at: 0x0F, u8: 0x33, name: WHO_AM_I, writable: false }
  - { at: 0x20, u8: 0x07, name: CTRL_REG1 }
  - { at: 0x28, s16le: "ax", name: OUT_X }
`

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

const ok = (structured: unknown): BenchResult => ({ text: JSON.stringify(structured), structured })
const err = (text: string): BenchResult => ({ text, is_error: true })

function fake(handlers: Record<string, (args: Record<string, unknown>) => BenchResult>) {
  const seen: { tool: string; args: Record<string, unknown>; poll?: boolean }[] = []
  const call: BenchCall = vi.fn(async (tool, args = {}, opts) => {
    seen.push({ tool, args, poll: opts?.poll })
    const h = handlers[tool]
    return h ? h(args) : err(`unknown tool ${tool}`)
  })
  return { call, seen }
}
const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>)

describe('parseDevice', () => {
  it('reads word registers of an I2C part', () => {
    const d = parseDevice(yaml('tmp117')) as DeviceDef
    expect(d.kind).toBe('i2c')
    expect(d.i2c).toEqual({ address: 0x48, alt: [0x49, 0x4a, 0x4b], addressBytes: 1 })
    const t = d.regs.find((r) => r.name === 'TEMP_RESULT')!
    expect(t).toMatchObject({ at: 0x00, type: 's16be', size: 2, writable: false })
    expect(d.regs.find((r) => r.name === 'DEVICE_ID')).toMatchObject({ at: 0x0f, writable: false })
    expect(i2cRegHex(d, t)).toBe('00')
  })

  it('reads commands and their answer length', () => {
    const d = parseDevice(yaml('sht4x')) as DeviceDef
    const m = d.regs.find((r) => r.at === 0xfd)!
    expect(m).toMatchObject({ name: 'command 0xFD', size: 6, command: { busyUs: 8300 } })
    const sht3x = parseDevice(yaml('sht3x')) as DeviceDef
    expect(sht3x.i2c?.addressBytes).toBe(2)
    const c = sht3x.regs.find((r) => r.command)!
    expect(i2cRegHex(sht3x, c)).toHaveLength(4)
  })

  it('reads an SPI part: the read bit, auto increment and the address mask', () => {
    const d = parseDevice(LIS3DH) as DeviceDef
    expect(d.spi).toMatchObject({ mode: 3, mask: 0x3f, dummy: 0 })
    const who = d.regs.find((r) => r.name === 'WHO_AM_I')!
    const x = d.regs.find((r) => r.name === 'OUT_X')!
    const ctrl = d.regs.find((r) => r.name === 'CTRL_REG1')!
    expect(spiReadHex(d, who)).toBe('8f00')
    expect(spiReadHex(d, x)).toBe('e80000')
    expect(spiWriteHex(d, ctrl, '57')).toBe('2057')
  })

  it('says why a definition has no registers', () => {
    expect(parseDevice(yaml('gps_nmea'))).toMatch(/uart definition has no registers/)
  })
})

describe('values', () => {
  const reg = (type: string, size: number) => ({ id: 0, at: 0, name: 'R', type: type as never, size, writable: true })
  it('decodes by the field type', () => {
    expect(decodeValue(reg('s16be', 2), '0c80')).toBe('3200')
    expect(decodeValue(reg('s16be', 2), 'ff00')).toBe('-256')
    expect(decodeValue(reg('s16le', 2), '00ff')).toBe('-256')
    expect(decodeValue(reg('u24le', 3), '010203')).toBe(String(0x030201))
    expect(decodeValue(reg('text', 2), '4f4b')).toBe('"OK"')
    expect(decodeValue(reg('bytes', 3), '0a0b0c')).toBe('0a 0b 0c')
  })
  it('encodes what the user types', () => {
    expect(encodeValue(reg('u8', 1), '0x57')).toEqual({ hex: '57' })
    expect(encodeValue(reg('s16be', 2), '-2')).toEqual({ hex: 'fffe' })
    expect(encodeValue(reg('s16be', 2), '0xfffe')).toEqual({ hex: 'fffe' })
    expect(encodeValue(reg('u16le', 2), '0x1234')).toEqual({ hex: '3412' })
    expect(encodeValue(reg('u8', 1), '256')).toEqual({ error: '0 to 255' })
    expect(encodeValue(reg('u8', 1), 'abc')).toMatchObject({ error: expect.stringContaining('a number') })
  })
})

describe('device mode', () => {
  it('I2C: picks a definition, reads a register by name and decodes it', async () => {
    const { call, seen } = fake({
      sensor_library: () => ok({ version: '0.1.0', entries: [{ name: 'tmp117', kind: 'i2c', label: 'Precision temperature' }, { name: 'lis3dh', kind: 'spi', label: 'Accelerometer' }] }),
      sensor_show: () => ok({ name: 'tmp117', kind: 'i2c', yaml: yaml('tmp117'), params: [] }),
      i2c_transfer: (a) => (a.write_hex === '00' ? ok({ addr: a.addr, ack: true, rx_hex: '0c80' }) : ok({ addr: a.addr, ack: false, rx_hex: '', nack_at: 2 })),
    })
    wrap(<I2cTab call={call} wiredSda={1} wiredScl={2} />)
    fireEvent.click(screen.getByLabelText('Device mode'))
    const def = await screen.findByLabelText('Definition', { selector: 'input' })
    await waitFor(() => expect((def as HTMLInputElement).placeholder).toBe('pick a part'))
    fireEvent.click(def)
    expect(screen.queryByRole('option', { name: 'Accelerometer', hidden: true })).toBeNull()
    fireEvent.click(await screen.findByRole('option', { name: 'Precision temperature', hidden: true }))
    const row = await screen.findByTestId('reg-TEMP_RESULT')
    fireEvent.click(within(row).getByRole('button', { name: 'Read TEMP_RESULT' }))
    await waitFor(() => expect(row.textContent).toContain('3200'))
    expect(row.textContent).toContain('0c 80')
    expect(seen.find((s) => s.tool === 'i2c_transfer')?.args).toEqual({ addr: 0x48, write_hex: '00', read: 2 })
    expect(seen.filter((s) => s.tool.startsWith('sensor_')).every((s) => s.poll)).toBe(true)
    // read-only registers have no write box
    expect(within(row).queryByRole('button', { name: 'Write TEMP_RESULT' })).toBeNull()

    const cfg = screen.getByTestId('reg-CONFIGURATION')
    fireEvent.change(within(cfg).getByLabelText('New value for CONFIGURATION'), { target: { value: '0x0220' } })
    fireEvent.click(within(cfg).getByRole('button', { name: 'Write CONFIGURATION' }))
    await waitFor(() => expect(cfg.textContent).toContain('NACK on byte 2'))
    expect(seen.filter((s) => s.tool === 'i2c_transfer')[1].args).toEqual({ addr: 0x48, write_hex: '010220', read: 0 })
  })

  it('SPI: the definition sets the mode, reads go out with the read bit', async () => {
    const { call, seen } = fake({
      sensor_library: () => ok({ version: '0.1.0', entries: [{ name: 'lis3dh', kind: 'spi', label: 'Accelerometer' }] }),
      sensor_show: () => ok({ name: 'lis3dh', kind: 'spi', yaml: LIS3DH, params: [] }),
      spi_transfer: () => ok({ rx_hex: 'ff33', hz: 1000000 }),
    })
    wrap(<SpiTab call={call} wired={{ sck: 3, mosi: 4, miso: 5, cs: 6 }} />)
    fireEvent.click(screen.getByLabelText('Device mode'))
    const def = await screen.findByLabelText('Definition', { selector: 'input' })
    await waitFor(() => expect((def as HTMLInputElement).placeholder).toBe('pick a part'))
    fireEvent.click(def)
    fireEvent.click(await screen.findByRole('option', { name: 'Accelerometer', hidden: true }))
    const row = await screen.findByTestId('reg-WHO_AM_I')
    expect((screen.getByLabelText('Mode', { selector: 'input' }) as HTMLInputElement).value).toBe('3 (CPOL 1, CPHA 1)')
    fireEvent.click(within(row).getByRole('button', { name: 'Read WHO_AM_I' }))
    await waitFor(() => expect(row.textContent).toContain('51'))
    expect(seen.find((s) => s.tool === 'spi_transfer')?.args).toEqual({ tx_hex: '8f00', sck: 3, mosi: 4, miso: 5, cs: 6, hz: 1000000, mode: 3 })
  })
})
