// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import wasmInline from '../engine/sensor_def.wasm?inline'
import bmp280 from '../testdata/bmp280.yaml?raw'
import sht4x from '../testdata/sht4x.yaml?raw'
import { fromBase64 } from '../chunk'
import { convertSource } from '../convert'
import { loadEngine, setEngineSource, type Engine } from '../engine'
import { fakePod } from '../fakePod'
import { commandSensorPod, type SensorPins } from '../pod'
import { MemorySensorStore } from '../store'
import { TEMPLATES } from '../templates'
import { SensorsPage } from './SensorsPage'

let engine: Engine
beforeAll(async () => {
  setEngineSource(fromBase64(wasmInline.slice(wasmInline.indexOf(',') + 1)))
  engine = await loadEngine()
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

const lib = { version: '0.1.0', entries: [{ source: bmp280 }, { source: sht4x }] }

function setup(opts: { capable?: boolean | null; pod?: ReturnType<typeof fakePod>; libraryScope?: 'organization' | 'computer'; heading?: boolean } = {}) {
  const store = new MemorySensorStore(
    lib,
    (json, kind) => {
      const r = kind === 'stimulus' ? engine.stimulusValidate(json) : engine.validate(json)
      return r.ok ? null : r.error
    },
    { canChangeLibrary: true },
  )
  const fp = opts.pod ?? fakePod(engine)
  const onUpdateFirmware = vi.fn()
  render(
    <MantineProvider>
      <SensorsPage
        store={store}
        pod={commandSensorPod(fp.send)}
        podOnline
        capable={opts.capable === undefined ? true : opts.capable}
        onUpdateFirmware={onUpdateFirmware}
        bench={{ pinDefaults: (k): SensorPins => (k === 'i2c' ? { sda: 1, scl: 2 } : {}) }}
        libraryScope={opts.libraryScope}
        heading={opts.heading}
      />
    </MantineProvider>,
  )
  return { store, fp, onUpdateFirmware }
}

describe('SensorsPage', () => {
  it('copies a library sensor, shows an error at its line, then runs it and sets a value', async () => {
    const { store, fp } = setup()
    const library = await screen.findByLabelText('Library')
    await within(library).findByText('bmp280')
    const row = within(library).getByText('bmp280').closest('tr')!
    fireEvent.click(within(row).getByText('Duplicate'))
    const src = (await screen.findByLabelText('Definition source')) as HTMLTextAreaElement
    expect(src.value).toContain('name: bmp280')
    expect((await store.list()).definitions.map((d) => d.name)).toEqual(['bmp280'])

    fireEvent.change(src, { target: { value: src.value.replace('"t_fine(adc_t)"', '"t_fin(adc_t)"') } })
    const err = await screen.findByLabelText('Validation error', {}, { timeout: 2000 })
    expect(err.textContent).toContain("unknown function 't_fin'")
    const line = src.value.split('\n').findIndex((l) => l.includes('t_fin(adc_t)')) + 1
    expect(err.textContent).toContain(`Line ${line}`)

    fireEvent.change(src, { target: { value: src.value.replace('"t_fin(adc_t)"', '"t_fine(adc_t)"') } })
    await screen.findByLabelText('Validation result', {}, { timeout: 2000 })
    expect(screen.getByLabelText('Register image')).toBeTruthy()

    fireEvent.click(screen.getByText('Start on the pod'))
    const card = await screen.findByLabelText('Instance bmp280', {}, { timeout: 3000 })
    expect(fp.commands.filter((c) => c.cmd === 'sensor_define').length).toBeGreaterThan(1)
    expect(fp.commands).toContainEqual({ cmd: 'sensor_start', instance: 'bmp280', pins: { sda: 1, scl: 2 }, address: '0x76' })

    fireEvent.change(within(card).getByLabelText('Temperature (C)'), { target: { value: '31.5' } })
    await waitFor(() => expect(fp.commands).toContainEqual({ cmd: 'sensor_set', instance: 'bmp280', values: { temperature_c: 31.5 } }))

    fireEvent.click(within(card).getByText('Read'))
    await within(card).findByLabelText('Register read-back')
  })

  it('says who the library version applies to', async () => {
    setup()
    await screen.findByText(/applies to your whole organization/)
    cleanup()
    setup({ libraryScope: 'computer' })
    await screen.findByText(/applies on this computer/)
    expect(screen.queryByText(/whole organization/)).toBeNull()
  })

  it('shows the firmware notice and still edits without the capability', async () => {
    const { onUpdateFirmware } = setup({ capable: false })
    fireEvent.click(await screen.findByText('Update firmware'))
    expect(onUpdateFirmware).toHaveBeenCalled()
    fireEvent.click(screen.getByText('New sensor'))
    fireEvent.click(await screen.findByText('Analog sensor'))
    await screen.findByLabelText('Analog output', {}, { timeout: 2000 })
    expect(screen.getByLabelText('Transfer curve')).toBeTruthy()
    expect(screen.getByText('Start on the pod').closest('button')!.disabled).toBe(true)
  })

  it('views are underline tabs; a host that names the page drops the heading; the notice is one line', async () => {
    setup({ capable: false, heading: false })
    expect(await screen.findByRole('tab', { name: 'My sensors', selected: true })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Stimuli' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'On the pod' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sensors' })).toBeNull()
    expect(screen.getByTestId('sensors-firmware-notice').textContent).toContain('Update the pod')
    cleanup()
    setup()
    expect(await screen.findByRole('heading', { name: 'Sensors' })).toBeTruthy()
  })

  it('draws a stimulus and starts it on the pod', async () => {
    const fp = fakePod(engine)
    const c = convertSource(TEMPLATES.i2c)
    if (!c.ok) throw new Error(c.error)
    const pod = commandSensorPod(fp.send)
    await pod.define('my_i2c_sensor', c.json)
    await pod.start('my_i2c_sensor', { pins: { sda: 1, scl: 2 } })
    const { store } = setup({ pod: fp })
    await store.save(TEMPLATES.stimulus)
    fireEvent.click(await screen.findByText('Stimuli'))
    fireEvent.click(await screen.findByText('my_stimulus'))
    await screen.findByLabelText('Stimulus chart')
    await screen.findByText(/55 s, 1 signal/, {}, { timeout: 2000 })
    const onPod = screen.getByLabelText('Stimulus on the pod')
    await waitFor(() => expect(within(onPod).getByText('Start on the pod').closest('button')!.disabled).toBe(false))
    fireEvent.click(within(onPod).getByText('Start on the pod'))
    await waitFor(() => expect(fp.commands).toContainEqual({ cmd: 'sensor_stimulus_start' }))
    expect(fp.stimulus.json).toContain('"temperature_c"')

    // A structured edit: a second segment shape changes the chart's duration.
    fireEvent.click(screen.getByText('Add fault'))
    await screen.findByText(/55 s, 1 signal/)
  })
})
