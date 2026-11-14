// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { ChatView } from './ChatView'
import { BenchPanel, benchOutputs } from './BenchPanel'
import { itemsFromHistory } from './useChat'

// A host that draws the agent's console, captures and power readings in its own pane (the web
// workspace's side pane): ChatView portals each section into the host's element.

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView ??= () => {}
  // The message box's autosize listens for font loads.
  if (!(document as { fonts?: unknown }).fonts) Object.defineProperty(document, 'fonts', { value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() } })
})
afterEach(cleanup)

const items = itemsFromHistory(
  [
    { role: 'assistant', content: '', tool_calls: [{ id: 'b', name: 'uart_read', arguments: '{}' }] },
    { role: 'tool', content: '{"text": "INFO fw=process-node\\n> "}', tool_call_id: 'b' },
  ],
  {},
)

describe('panel slots', () => {
  it('draws the console into the host element, with no panel or panel button of its own', () => {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    const onPanelShow = vi.fn()
    render(
      <MantineProvider>
        <ChatView items={items} running={false} onSend={() => {}} onStop={() => {}} onConfirm={() => {}} panelSlots={{ console: slot }} onPanelShow={onPanelShow} />
      </MantineProvider>,
    )
    expect(slot.textContent).toContain('INFO fw=process-node')
    expect(screen.queryByRole('button', { name: 'Bench panel' })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Captures/ })).toBeNull()
    expect(onPanelShow).toHaveBeenCalledWith('console')
  })

  it('BenchPanel draws one section alone', () => {
    render(
      <MantineProvider>
        <BenchPanel outputs={benchOutputs([])} tab="console" onTab={() => {}} onSelect={() => {}} only="captures" />
      </MantineProvider>,
    )
    expect(screen.getByText('ADC and logic captures appear here.')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
