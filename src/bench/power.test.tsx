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
  it('Restart board switches the rail that is on off and on again, with the pins profile', async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = []
    const call = vi.fn(async (tool: string, args: Record<string, unknown> = {}, opts?: { approved?: boolean }): Promise<BenchResult> => {
      calls.push({ tool, args })
      if ((tool === 'power_on' || tool === 'power_off') && !opts?.approved) throw new Error('a restart sends both calls approved')
      if (tool === 'power_status') return { text: '', structured: { internal: rail(true), external: rail(false) } } as BenchResult
      if (tool === 'wiring')
        return { text: '', structured: { profile_name: 'hwtest-a', default_profile: 'hwtest-a', profiles: [{ name: 'hwtest-a' }], efuse: 1, la_voltage: 3.3 } } as BenchResult
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
})
