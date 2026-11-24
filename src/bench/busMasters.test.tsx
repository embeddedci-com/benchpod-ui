// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { BusMasterNote, emulationWithoutMasters, runningDigitalSensors, useBusMasterGate } from './busMasters'
import type { BenchCall, BenchResult } from './benchCall'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

describe('bus master gate', () => {
  it('knows when the running image lacks the bus masters', () => {
    expect(emulationWithoutMasters({ image: 2, version: 65, features: 4 })).toBe(true)
    expect(emulationWithoutMasters({ image: 2, version: 64, features: 4 })).toBe(false)
    expect(emulationWithoutMasters({ image: 2, version: 65, features: 0x24 })).toBe(false)
    expect(emulationWithoutMasters({ image: 0, version: 65, features: 0x29 })).toBe(false)
    expect(emulationWithoutMasters(undefined)).toBe(false)
  })

  it('lists running digital sensors only', () => {
    expect(runningDigitalSensors({ instances: [{ instance: 'a', kind: 'i2c', running: true }, { instance: 'b', kind: 'analog', running: true }, { instance: 'c', kind: 'spi', running: false }] })).toEqual(['a'])
  })

  function Probe({ call }: { call: BenchCall }) {
    const gate = useBusMasterGate(call, 60000)
    return <BusMasterNote gate={gate} />
  }
  const mk = (img: object, sensors: object[]) =>
    vi.fn(async (tool: string): Promise<BenchResult> => ({ text: '', structured: tool === 'fpga_image' ? img : { instances: sensors } })) as unknown as BenchCall

  it('shows "Stop the sensors first" on the emulation image with sensors running', async () => {
    render(<MantineProvider><Probe call={mk({ image: 2, version: 65, features: 4 }, [{ instance: 'env', kind: 'i2c', running: true }])} /></MantineProvider>)
    await waitFor(() => expect(screen.getByTestId('bus-master-note').textContent).toContain('Stop the sensors first'))
  })

  it('shows nothing when no sensor runs', async () => {
    const call = mk({ image: 2, version: 65, features: 4 }, [])
    render(<MantineProvider><Probe call={call} /></MantineProvider>)
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('bus-master-note')).toBeNull()
  })
})
