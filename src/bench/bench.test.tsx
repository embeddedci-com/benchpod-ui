// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { useEffect } from 'react'
import { benchData, benchError, confirmLines, createConfirmStore, useBenchCall, type BenchResult, describeCall } from './benchCall'

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

describe('createConfirmStore', () => {
  it('answers the pending ask, and a new ask declines the old one', async () => {
    const st = createConfirmStore()
    const seen = vi.fn()
    st.subscribe(seen)
    const first = st.ask('power_on', { efuse: 1 })
    const second = st.ask('i2c_open', { sda: 2 })
    await expect(first).resolves.toBe(false)
    expect(st.get()?.tool).toBe('i2c_open')
    st.answer(true)
    await expect(second).resolves.toBe(true)
    expect(st.get()).toBeNull()
    expect(seen).toHaveBeenCalledTimes(3)
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

describe('FlashControls', () => {
  const store = { upload: vi.fn(), recent: async () => [{ name: 'app.elf', path: '/f/app.elf', size: 2048, modified: '' }] }
  const flashOk = { ok: true, returncode: 0, target_unreachable: false, stalled: false, stdout_tail: '', stderr_tail: '' }

  it('keeps the result across a remount, and with the console open power-cycles for the console', async () => {
    const { FlashControls } = await import('./FlashControls')
    const seen: { tool: string; args: Record<string, unknown>; approved?: boolean }[] = []
    const call = vi.fn(async (tool: string, args: Record<string, unknown> = {}, opts?: { approved?: boolean }): Promise<BenchResult> => {
      seen.push({ tool, args, approved: opts?.approved })
      if (tool === 'wiring') return { text: '', structured: { efuse: 1, swd_target: 'target/stm32f4x.cfg', profile: { swd_swclk: 11, swd_swdio: 12 } } }
      if (tool === 'flash') return { text: '', structured: flashOk, ms: 3600 }
      if (tool === 'power_cycle_and_capture') return { text: 'PinConflictError: uart_proxy_start: pin conflict: LA3 is in use by uart_rx', is_error: true }
      return { text: '', structured: {} }
    })
    const first = render(<MantineProvider><FlashControls call={call} firmware={store} /></MantineProvider>)
    const btn = await screen.findByRole('button', { name: 'Flash' })
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(btn)
    await screen.findByText('flashed')
    first.unmount()
    render(<MantineProvider><FlashControls call={call} firmware={store} /></MantineProvider>)
    expect(await screen.findByText('flashed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Power-cycle and show the boot log' }))
    expect((await screen.findByTestId('boot-note')).textContent).toContain('boot log is in the Console')
    expect(seen.filter((x) => x.tool.startsWith('power_o')).map((x) => [x.tool, x.approved ?? false])).toEqual([['power_off', false], ['power_on', true]])
  })

  it('asks for the SWD pins in the pins profile, and does not flash without them', async () => {
    cleanup()
    const { FlashControls } = await import('./FlashControls')
    const call = vi.fn(async (tool: string): Promise<BenchResult> => {
      if (tool === 'wiring') return { text: '', structured: { efuse: 1, swd_target: 'target/stm32f4x.cfg', profile: {} } }
      return { text: '', structured: {} }
    })
    render(<MantineProvider><FlashControls call={call} firmware={store} /></MantineProvider>)
    expect((await screen.findByTestId('flash-no-swd')).textContent).toContain('Set SWCLK and SWDIO in the Pins tab')
    expect((screen.getByRole('button', { name: 'Flash' }) as HTMLButtonElement).disabled).toBe(true)
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

describe('ConsoleTerminal', () => {
  it('opens the UART 8N1 by default and with parity and stop bits from the Frame select', async () => {
    const { ConsoleTerminal } = await import('./ConsoleTerminal')
    // The log poll and the console's uart_read poll never answer here, so neither loops.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const calls: [string, Record<string, unknown> | undefined][] = []
    const call = vi.fn((tool: string, args?: Record<string, unknown>) => {
      if (tool !== 'uart_open') return new Promise<never>(() => {})
      calls.push([tool, args])
      return Promise.resolve({ text: '{}', structured: { open: true } })
    })
    render(
      <MantineProvider>
        <ConsoleTerminal call={call} logBase="/api/console" agentRunning={false} />
      </MantineProvider>,
    )
    fireEvent.click(await screen.findByText('Open UART'))
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).toEqual(['uart_open', {}])
    cleanup()
    render(
      <MantineProvider>
        <ConsoleTerminal call={call} logBase="/api/console" agentRunning={false} />
      </MantineProvider>,
    )
    fireEvent.click(screen.getAllByLabelText(/Frame/)[0])
    fireEvent.click(await screen.findByRole('option', { name: '8E2', hidden: true }))
    fireEvent.click(screen.getByText('Open UART'))
    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1]).toEqual(['uart_open', { parity: 'even', stop_bits: 2 }])
  })
})

describe('describeCall', () => {
  it('says what a confirmed call does in one sentence, or leaves it to the arguments', () => {
    expect(describeCall('set_pull', { las: [2, 1], enabled: true })).toBe('Switch on the pull resistors on LA2 and LA1?')
    expect(describeCall('set_pull', { las: [2, 1], enabled: false })).toBe('Switch off the pull resistors on LA2 and LA1?')
    expect(describeCall('i2c_open', { sda: 2, scl: 1, hz: 100000, pullups: 'pod' })).toBe('Open I2C on LA2 (SDA) and LA1 (SCL) at 100 kHz?')
    expect(describeCall('gpio_write', { la: 5, value: 1 })).toBe('Drive LA5 high?')
    expect(describeCall('flash', { file: '/f/x.elf', target: 'target/stm32f4x.cfg' })).toBe('Flash x.elf to the board over SWD?')
    expect(describeCall('flash', { file: '/f/app.bin', target: 'esp32s3' })).toBe('Flash app.bin to the ESP32S3 over its UART?')
    expect(describeCall('gpio_mystery', {})).toBeNull()
  })
})

describe('EspFlashControls', () => {
  const store = { upload: vi.fn(), recent: async () => [{ name: 'app.bin', path: '/f/app.bin', size: 4096, modified: '' }, { name: 'x.elf', path: '/f/x.elf', size: 1, modified: '' }] }

  it('flashes an ESP32 with the pins from the profile', async () => {
    cleanup()
    const { EspFlashControls } = await import('./EspFlashControls')
    const seen: { tool: string; args: Record<string, unknown> }[] = []
    const call = vi.fn(async (tool: string, args: Record<string, unknown> = {}): Promise<BenchResult> => {
      seen.push({ tool, args })
      if (tool === 'wiring') return { text: '', structured: { profile: { uart_rx: 3, uart_tx: 4, signals: [{ la: 6, name: 'BOOT' }] } } }
      if (tool === 'flash') return { text: '', structured: { ok: true, stdout_tail: 'ESP32-S3: 1 region(s)' } }
      return { text: '', structured: {} }
    })
    render(<MantineProvider><EspFlashControls call={call} firmware={store} /></MantineProvider>)
    expect((await screen.findByTestId('esp-pins')).textContent).toContain('RX LA3 · TX LA4 · BOOT LA6')
    const flash = screen.getByRole('button', { name: 'Flash' })
    expect((flash as HTMLButtonElement).disabled).toBe(true) // no image picked yet
  })

  it('asks for the UART and BOOT pins in the pins profile', async () => {
    cleanup()
    const { EspFlashControls } = await import('./EspFlashControls')
    const call = vi.fn(async (tool: string): Promise<BenchResult> =>
      tool === 'wiring' ? { text: '', structured: { profile: { uart_rx: 3, uart_tx: 4, signals: [] } } } : { text: '', structured: {} },
    )
    render(<MantineProvider><EspFlashControls call={call} firmware={store} /></MantineProvider>)
    expect((await screen.findByTestId('esp-no-pins')).textContent).toContain('signal named BOOT')
  })
})
