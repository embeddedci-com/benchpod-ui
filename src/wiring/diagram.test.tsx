// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { WiringDiagram, changedChannels } from './WiringDiagram'
import { WiringProfilePicker } from './WiringProfilePicker'
import { effectiveWiring } from './model'

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
})
afterEach(cleanup)

const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>)

describe('WiringDiagram', () => {
  it('draws every LA channel, what it is wired to, and the I/O voltage and supply', () => {
    const w = effectiveWiring({ version: 2, la_mv: 1800, supply: 'external', uart_rx: 3, swd_swclk: 11 })
    wrap(<WiringDiagram wiring={w} title="k66" />)
    expect(screen.getByText('LA14')).toBeTruthy()
    expect(screen.getByText('I/O voltage 1.8 V, target power external supply')).toBeTruthy()
    expect(screen.getAllByText('not wired').length).toBe(12)
  })
  it('says when nothing is set', () => {
    wrap(<WiringDiagram wiring={effectiveWiring({ version: 2 })} />)
    expect(screen.getByText('I/O voltage not set, target power not set')).toBeTruthy()
  })
  it('marks the channels whose wiring changed', () => {
    const saved = effectiveWiring({ version: 2, uart_rx: 3, uart_tx: 4 })
    const draft = effectiveWiring({ version: 2, uart_rx: 5, uart_tx: 4 })
    expect([...changedChannels(draft, saved)].sort()).toEqual([3, 5])
  })
})

describe('WiringProfilePicker', () => {
  it('marks the active profile and offers make active for the others', () => {
    wrap(
      <WiringProfilePicker
        profiles={[
          { name: 'k66', rev: 3, isDefault: true },
          { name: 'nrf', rev: 1, isDefault: false, source: 'mcp' },
        ]}
        selected="nrf"
        onSelect={() => {}}
        onMakeDefault={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByText('Make active')).toBeTruthy()
  })

  it('deletes the profile on screen from the ⋯ menu; the active one is greyed out and says why', async () => {
    const onDelete = vi.fn()
    const profiles = [
      { name: 'k66', rev: 3, isDefault: true },
      { name: 'nrf', rev: 1, isDefault: false },
    ]
    const { rerender } = wrap(
      <WiringProfilePicker profiles={profiles} selected="nrf" onSelect={() => {}} onMakeDefault={() => {}} onDelete={onDelete} />,
    )
    fireEvent.click(screen.getByLabelText('More profile actions'))
    fireEvent.click(await screen.findByTestId('delete-profile'))
    expect(onDelete).toHaveBeenCalledWith('nrf')
    rerender(
      <MantineProvider>
        <WiringProfilePicker profiles={profiles} selected="k66" onSelect={() => {}} onMakeDefault={() => {}} onDelete={onDelete} />
      </MantineProvider>,
    )
    fireEvent.click(screen.getByLabelText('More profile actions'))
    const item = await screen.findByTestId('delete-profile')
    expect(item.hasAttribute('disabled') || item.getAttribute('data-disabled') === 'true').toBe(true)
    expect(screen.getByText(/The active profile can't be deleted/)).toBeTruthy()
  })
})
