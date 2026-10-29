import { describe, expect, it } from 'vitest'
import { applyEvent, itemsFromHistory, type ChatItem } from './useChat'
import { readEvents, type ChatEvent } from './protocol'
import { parseBlocks } from './Markdown'
import { callSummary } from './ChatView'

const call = { id: 'c1', name: 'uart_read', arguments: '{"until_regex":"ready>"}' }

describe('applyEvent', () => {
  it('streams text, then a tool call with its confirmation and result', () => {
    let items: ChatItem[] = [{ kind: 'user', id: 'u', text: 'boot it' }]
    const events: ChatEvent[] = [
      { type: 'text', text: 'Reading ' },
      { type: 'text', text: 'the console.' },
      { type: 'tool_call', call },
      { type: 'confirm', call },
      { type: 'tool_result', call, result: { text: 'ok', structured: { text: 'ready>' } }, ms: 12 },
      { type: 'limit', text: 'limit reached' },
    ]
    for (const e of events) items = applyEvent(items, e)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'notice'])
    expect(items[1]).toMatchObject({ text: 'Reading the console.' })
    expect(items[2]).toMatchObject({ confirming: false, ms: 12, result: { structured: { text: 'ready>' } } })
  })

  it('shows a stop as info and other errors as errors', () => {
    expect(applyEvent([], { type: 'error', error: 'stopped' })[0]).toMatchObject({ level: 'info' })
    expect(applyEvent([], { type: 'error', error: 'HTTP 402' })[0]).toMatchObject({ level: 'error', text: 'HTTP 402' })
  })
})

describe('itemsFromHistory', () => {
  it('pairs tool results with their calls', () => {
    const items = itemsFromHistory([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [call] },
      { role: 'tool', content: 'not run: the user declined this call', tool_call_id: 'c1' },
      { role: 'assistant', content: 'Done.' },
    ])
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(items[1]).toMatchObject({ result: { is_error: true } })
  })

  it('draws kept structured results again', () => {
    const items = itemsFromHistory(
      [
        { role: 'assistant', content: '', tool_calls: [{ id: 'c9', name: 'capture_adc', arguments: '{}' }] },
        { role: 'tool', content: '{"mean": 1.5}', tool_call_id: 'c9' },
      ],
      { c9: { mean: 1.5, envelope_min: [1], envelope_max: [2], envelope_step: 0.001 } },
    )
    expect(items[0]).toMatchObject({ result: { structured: { mean: 1.5 } } })
  })
})

describe('readEvents', () => {
  it('splits frames across chunk boundaries and skips comments', async () => {
    const chunks = [': ping\n\ndata: {"type":"te', 'xt","text":"a"}\n\ndata: {"type":"done"}\n\n']
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const s of chunks) c.enqueue(new TextEncoder().encode(s))
        c.close()
      },
    })
    const got: ChatEvent[] = []
    for await (const e of readEvents(body)) got.push(e)
    expect(got).toEqual([{ type: 'text', text: 'a' }, { type: 'done' }])
  })
})

describe('Markdown', () => {
  it('parses code, lists, tables and paragraphs', () => {
    const b = parseBlocks('# Boot\nThe log:\n```\nready>\n```\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'code', 'ul', 'table'])
  })
})

describe('callSummary', () => {
  it('prints the call like a terminal agent', () => {
    expect(callSummary(call)).toBe('uart_read(until_regex: "ready>")')
  })
})

import { groupTools } from './ToolsList'

describe('groupTools', () => {
  it('groups by what the tool works on, unknown ones last', () => {
    const g = groupTools([
      { name: 'uart_read', summary: '' },
      { name: 'status', summary: '' },
      { name: 'enable_i2c_sensor', summary: '' },
      { name: 'power_on', summary: '' },
      { name: 'brand_new_tool', summary: '' },
    ])
    expect(g.map((x) => x.title)).toEqual(['Bench', 'Power and reset', 'UART console', 'Sensor emulation', 'Other'])
  })
})

import { benchOutputs } from './BenchPanel'

describe('benchOutputs', () => {
  it('collects the console in order and the captures', () => {
    const items = itemsFromHistory(
      [
        { role: 'assistant', content: '', tool_calls: [
          { id: 'a', name: 'uart_write', arguments: '{"text":"info"}' },
          { id: 'b', name: 'uart_read', arguments: '{}' },
          { id: 'c', name: 'capture_adc', arguments: '{}' },
          { id: 'd', name: 'status', arguments: '{}' },
        ] },
        { role: 'tool', content: '{"written": 5}', tool_call_id: 'a' },
        { role: 'tool', content: '{"text": "INFO fw=process-node\\n> "}', tool_call_id: 'b' },
        { role: 'tool', content: '{}', tool_call_id: 'c' },
        { role: 'tool', content: '{}', tool_call_id: 'd' },
      ],
      { c: { mean: 1.5, min: 1, max: 2, peak_to_peak: 1, samples: 10, sample_rate_hz: 1000, duration: 0.01, envelope_step: 0.001, envelope_min: [1], envelope_max: [2] } },
    )
    const o = benchOutputs(items)
    expect(o.console.map((e) => [e.dir, e.text])).toEqual([['in', 'info'], ['out', 'INFO fw=process-node\n> ']])
    expect(o.captures).toHaveLength(1)
    expect(o.captures[0].title).toBe('ADC · 1.50 V · 1.00 V p-p')
  })
})
