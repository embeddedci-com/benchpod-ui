// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { PowerControls } from './PowerControls'
import type { BenchCall, BenchResult } from './benchCall'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const rail = (enabled: boolean) => ({ enabled, current: enabled ? 0.05 : 0, bus_voltage: 5, fault: false })

describe('PowerControls', () => {
  it('Restart board switches the supply that is on off and on again, with the pins profile', async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = []
    const call = vi.fn(async (tool: string, args: Record<string, unknown> = {}, opts?: { approved?: boolean }): Promise<BenchResult> => {
      calls.push({ tool, args })
      if ((tool === 'power_on' || tool === 'power_off') && !opts?.approved) throw new Error('a restart sends both calls approved')
      if (tool === 'power_status') return { text: '', structured: { supplies: { '5v': rail(true), external: rail(false) }, internal: rail(true), external: rail(false) } } as BenchResult
      if (tool === 'wiring')
        return { text: '', structured: { profile_name: 'hwtest-a', default_profile: 'hwtest-a', profiles: [{ name: 'hwtest-a' }], supply: '5v', la_voltage: 3.3 } } as BenchResult
      return { text: 'ok', structured: {} } as BenchResult
    }) as unknown as BenchCall
    render(
      <MantineProvider>
        <PowerControls call={call} pollMs={60_000} />
      </MantineProvider>,
    )
    fireEvent.click(await screen.findByTestId('restart-board'))
    fireEvent.click(await screen.findByTestId('restart-confirm'))
    await waitFor(() => expect(calls.some((c) => c.tool === 'power_on')).toBe(true))
    const power = calls.filter((c) => c.tool === 'power_off' || c.tool === 'power_on')
    expect(power).toEqual([
      { tool: 'power_off', args: { efuse: 1 } },
      { tool: 'power_on', args: { efuse: 1, wiring_profile: 'hwtest-a' } },
    ])
  })

  it('shows 3.3 V and 1.8 V only when the pod reports them, and switches them by supply name', async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = []
    let switched = true
    const call = vi.fn(async (tool: string, args: Record<string, unknown> = {}): Promise<BenchResult> => {
      calls.push({ tool, args })
      if (tool === 'power_status')
        return {
          text: '',
          structured: { supplies: { '5v': rail(false), external: rail(false), ...(switched ? { '3v3': { enabled: true }, '1v8': { enabled: true } } : {}) } },
        } as BenchResult
      if (tool === 'wiring') return { text: '', structured: { profile_name: 'p', default_profile: 'p', profiles: [{ name: 'p' }], supply: '3v3', la_voltage: 3.3 } } as BenchResult
      return { text: 'ok', structured: {} } as BenchResult
    }) as unknown as BenchCall
    const { unmount } = render(
      <MantineProvider>
        <PowerControls call={call} pollMs={60_000} />
      </MantineProvider>,
    )
    expect(await screen.findByText('3.3 V')).toBeTruthy()
    expect(await screen.findByText(/power 3\.3 V/)).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /1\.8 V/ }))
    await waitFor(() => expect(calls.some((c) => c.tool === 'power_off')).toBe(true))
    expect(calls.find((c) => c.tool === 'power_off')?.args).toEqual({ supply: '1v8' })
    unmount()
    switched = false
    render(
      <MantineProvider>
        <PowerControls call={call} pollMs={60_000} />
      </MantineProvider>,
    )
    expect(await screen.findByText('5 V')).toBeTruthy()
    expect(screen.queryByText('3.3 V')).toBeNull()
  })

  it('still reads the pre-supplies power_status keys and a profile with the legacy efuse', async () => {
    const call = vi.fn(async (tool: string): Promise<BenchResult> => {
      if (tool === 'power_status') return { text: '', structured: { internal: rail(false), external: rail(true) } } as BenchResult
      if (tool === 'wiring') return { text: '', structured: { profile_name: 'p', default_profile: 'p', profiles: [{ name: 'p' }], efuse: 2, la_voltage: 3.3 } } as BenchResult
      return { text: 'ok', structured: {} } as BenchResult
    }) as unknown as BenchCall
    render(
      <MantineProvider>
        <PowerControls call={call} pollMs={60_000} />
      </MantineProvider>,
    )
    expect(await screen.findByText(/power external supply/)).toBeTruthy()
    expect((screen.getByRole('switch', { name: /External/ }) as HTMLInputElement).checked).toBe(true)
  })
})
