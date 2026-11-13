// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import wasmInline from '../engine/sensor_def.wasm?inline'
import tmp117 from '../testdata/tmp117.yaml?raw'
import sht3x from '../testdata/sht3x.yaml?raw'
import bmp280 from '../testdata/bmp280.yaml?raw'
import { fromBase64 } from '../chunk'
import { convertSource } from '../convert'
import { loadEngine, setEngineSource, type Engine, type ValidateOk } from '../engine'
import { DefinitionPreview, defaultValues } from './Preview'

let engine: Engine
beforeAll(async () => {
  setEngineSource(fromBase64(wasmInline.slice(wasmInline.indexOf(',') + 1)))
  engine = await loadEngine()
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

function show(yaml: string) {
  const c = convertSource(yaml)
  if (!c.ok) throw new Error(c.error)
  const info = engine.validate(c.json)
  if (!info.ok) throw new Error(info.error)
  render(
    <MantineProvider>
      <DefinitionPreview engine={engine} json={c.json} info={info} values={defaultValues(info.params)} />
    </MantineProvider>,
  )
  return info as ValidateOk
}

describe('DefinitionPreview', () => {
  it('shows a word-register sensor (tmp117) as 16-bit registers by pointer', () => {
    const info = show(tmp117)
    expect(info.bus?.register_bytes).toBe(2)
    const grid = screen.getByRole('table', { name: 'Registers (16-bit, MSB first)' })
    const cells = grid.querySelectorAll('td[data-reg]')
    expect(cells).toHaveLength(128)
    // 25 C at 7.8125 m°C per LSB = 3200 = 0x0C80, rebuilt and read-only.
    const temp = grid.querySelector('td[data-reg="00"]')!
    expect(temp.textContent).toBe('0C80')
    expect(temp.getAttribute('data-dynamic')).toBe('true')
    expect(temp.getAttribute('title')).toContain('register 0x00 (image 0x00-0x01)')
    expect(temp.getAttribute('title')).toContain('read-only')
    expect(grid.querySelector('td[data-reg="01"]')!.textContent).toBe('2220')
    expect(grid.querySelector('td[data-reg="0F"]')!.textContent).toBe('0117')
    expect(screen.queryByRole('table', { name: 'Commands' })).toBeNull()
  })

  it('shows a command-map sensor (sht3x) with its commands and the bytes each reads', () => {
    const info = show(sht3x)
    expect(info.bus?.command_map).toBe(true)
    expect(screen.getByRole('table', { name: 'Register image' }).querySelectorAll('td[data-reg]')).toHaveLength(256)
    const cmds = screen.getByRole('table', { name: 'Commands' })
    const rows = cmds.querySelectorAll('tr[data-command]')
    expect(rows).toHaveLength(info.bus!.map!.length)
    // Single shot, high repeatability, clock stretching: 6 bytes, temperature and humidity with CRCs.
    const single = cmds.querySelector('tr[data-command="2C06"]')!
    const m = info.bus!.map!.find((x) => x.addr === 0x2c06)!
    expect(m.span).toBe(6)
    expect(within(single as HTMLElement).getAllByRole('cell')[2].textContent!.split(' ')).toHaveLength(6)
  })

  it('keeps byte registers as they were (bmp280)', () => {
    show(bmp280)
    const grid = screen.getByRole('table', { name: 'Register image' })
    expect(grid.querySelectorAll('td[data-reg]')).toHaveLength(256)
    expect(grid.querySelector('td[data-reg="D0"]')!.textContent).toBe('58')
  })
})
