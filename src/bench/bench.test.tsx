// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { useEffect } from 'react'
import { benchData, benchError, confirmLines, useBenchCall, type BenchResult } from './benchCall'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness({ onResult }: { onResult: (r: BenchResult) => void }) {
  const { call, dialog } = useBenchCall('/api/tool')
  useEffect(() => {
    void call('power_on', { efuse: 1 }).then(onResult)
  }, [call, onResult])
  return <MantineProvider>{dialog}</MantineProvider>
}

describe('useBenchCall', () => {
  it('asks before a risky call and sends it again with confirmed', async () => {
    const bodies: { confirmed: boolean }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string)
      bodies.push(b)
      return new Response(JSON.stringify(b.confirmed ? { text: '{"efuse":1,"on":true}', structured: { efuse: 1, on: true } } : { confirm: true }))
    }))
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(await screen.findByText('Run it'))
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(bodies.map((b) => b.confirmed)).toEqual([false, true])
    expect(benchData(onResult.mock.calls[0][0])).toEqual({ efuse: 1, on: true })
  })

  it('a no is a declined result, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ confirm: true }))))
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(await screen.findByText('Cancel'))
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    const r = onResult.mock.calls[0][0] as BenchResult
    expect(r.declined).toBe(true)
    expect(benchError(r)).toBeUndefined()
  })
})

describe('confirmLines', () => {
  it('shows addresses in hex, bytes as hex, and nothing cut short', () => {
    const long = 'ab'.repeat(80)
    expect(confirmLines({ addr: 66, write_hex: long, read: 2, data: [1, 255], can_id: 0x123 })).toEqual([
      ['addr', '0x42 (66)'],
      ['write_hex', long],
      ['read', '2'],
      ['data', '01 FF'],
      ['can_id', '0x123 (291)'],
    ])
  })
})

describe('approved calls', () => {
  it('go confirmed at once, with no dialog', async () => {
    const bodies: { confirmed: boolean }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string))
      return new Response(JSON.stringify({ text: 'ok' }))
    }))
    const onResult = vi.fn()
    function H() {
      const { call, dialog } = useBenchCall('/api/tool')
      useEffect(() => {
        void call('i2c_transfer', { addr: 0x76, write_hex: 'd0', read: 1 }, { approved: true }).then(onResult)
      }, [call])
      return <MantineProvider>{dialog}</MantineProvider>
    }
    render(<H />)
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(bodies.map((b) => b.confirmed)).toEqual([true])
    expect(screen.queryByText('Run it')).toBeNull()
  })
})

describe('parseWaveformCsv', () => {
  it('takes one value per line', async () => {
    const { parseWaveformCsv } = await import('./GeneratorControls')
    expect(parseWaveformCsv('0\n1.5\n\n3\n')).toEqual({ samples: [0, 1.5, 3], rateHz: undefined })
  })
  it('reads the rate from a time column and skips a header', async () => {
    const { parseWaveformCsv } = await import('./GeneratorControls')
    const r = parseWaveformCsv('time,volts\n0,0.1\n0.001,0.2\n0.002,0.3\n')
    expect(r.samples).toEqual([0.1, 0.2, 0.3])
    expect(r.rateHz).toBeCloseTo(1000)
  })
})

describe('newerVersion', () => {
  it('compares dotted versions numerically', async () => {
    const { newerVersion } = await import('./PodUpdate')
    expect(newerVersion('3.10.2', '3.10.1')).toBe(true)
    expect(newerVersion('3.10.1', '3.10.1')).toBe(false)
    expect(newerVersion('3.9.9', '3.10.0')).toBe(false)
    expect(newerVersion('v3.11.0', '3.10.12')).toBe(true)
    expect(newerVersion(undefined, '3.10.1')).toBe(false)
  })
})

describe('SPI flash helpers', () => {
  it('parses hex, decimal and k addresses', async () => {
    const { parseSpiAddr } = await import('./SpiFlashControls')
    expect(parseSpiAddr('0x1000')).toBe(4096)
    expect(parseSpiAddr('4096')).toBe(4096)
    expect(parseSpiAddr('64k')).toBe(65536)
    expect(parseSpiAddr('zz')).toBeNaN()
  })
  it('dumps hex with addresses and ASCII', async () => {
    const { hexDump } = await import('./SpiFlashControls')
    expect(hexDump('48690a', 0x100)).toBe('000100  48 69 0a' + ' '.repeat(39) + '  Hi.')
  })
})
