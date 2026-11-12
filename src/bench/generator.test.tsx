// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { BenchCall, BenchResult } from './benchCall'
import { GeneratorControls, type WaveformLibrary } from './GeneratorControls'
import { buildCurve, buildFault, curveAt, segmentsToSamples, sweepPlan, valueToCode, codeToValue } from './generatorMath'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
})
afterEach(cleanup)

describe('generator math', () => {
  it('maps values to codes on each output, 0 V mid-scale on 12v', () => {
    expect(valueToCode(0, '3v3')).toBe(0)
    expect(valueToCode(3.3, '3v3')).toBe(65535)
    expect(valueToCode(0, '12v')).toBe(32768)
    expect(valueToCode(99, '5v')).toBe(65535)
    expect(codeToValue(65535, '5v')).toBe(5)
    expect(valueToCode(0.004, 'current_out')).toBe(0)
  })

  it('builds a fault in samples and codes; stuck has no level', () => {
    expect(buildFault('flatline', 50, 10, 1000, 1.65, '3v3')).toEqual({ type: 'flatline', start: 500, width: 100, level: 32768 })
    expect(buildFault('spike', 95, 50, 1000, 5, '5v')).toEqual({ type: 'spike', start: 950, width: 50, level: 65535 })
    expect(buildFault('stuck', 0, 1, 10, 0, '3v3')).toEqual({ type: 'stuck', start: 0, width: 1 })
  })

  it('renders segments at 5 kS/s with the authored durations', () => {
    const r = segmentsToSamples([
      { shape: 'ramp', durationMs: 10, vStart: 0, vEnd: 1 },
      { shape: 'hold', durationMs: 10, vStart: 2, vEnd: 9 },
      { shape: 'step', durationMs: 0.2, vStart: 0, vEnd: 3 },
    ])
    expect(r.samples).toHaveLength(101)
    expect(r.samples[0]).toBe(0)
    expect(r.samples[49]).toBe(1)
    expect(r.samples[50]).toBe(2)
    expect(r.samples[100]).toBe(3)
    expect(r.rateHz * r.durationS).toBeCloseTo(101)
  })

  it('slows a long signal down to the sample cap', () => {
    const r = segmentsToSamples([{ shape: 'hold', durationMs: 100_000, vStart: 1, vEnd: 1 }], 1000)
    expect(r.samples).toHaveLength(1000)
    expect(r.rateHz).toBeCloseTo(10)
  })

  it('builds the panel curve from the top down to the zero code', () => {
    const c = buildCurve('panel', 60000, 6, 0)
    expect(c).toHaveLength(256)
    expect(c[0]).toBe(60000)
    expect(c[255]).toBe(0)
    expect(curveAt(c, 0)).toBe(60000)
    const up = buildCurve('linear-up', 65535, 6, 32768)
    expect(up[0]).toBe(32768)
    expect(up[255]).toBe(65535)
  })

  it('plans a sweep: slow passes stretch the tick, fast ones the step', () => {
    expect(sweepPlan(2)).toEqual({ tickDiv: 1458, step: 1 })
    expect(sweepPlan(0).tickDiv).toBe(8)
  })
})

function harness(call: BenchCall, library?: WaveformLibrary) {
  render(
    <MantineProvider>
      <GeneratorControls call={call} library={library} />
    </MantineProvider>,
  )
}

const ok = (text = '{}'): BenchResult => ({ text })

describe('GeneratorControls extras', () => {
  it('plays a segmented signal through replay with volts and its rate', async () => {
    const call = vi.fn<BenchCall>(async () => ok())
    harness(call)
    fireEvent.click(screen.getByText('Segments'))
    fireEvent.click(screen.getByText('Play'))
    await waitFor(() => expect(call).toHaveBeenCalled())
    const [tool, args] = call.mock.calls[0]
    expect(tool).toBe('replay')
    expect(args).toMatchObject({ dac_path: '3v3', mapping: 'faithful', sample_rate_hz: 5000 })
    expect((args!.volts as number[]).length).toBe(57600)
  })

  it('injects a fault into a library waveform', async () => {
    const play = vi.fn(async () => ok())
    const library: WaveformLibrary = {
      list: async () => [{ id: 'w1', name: 'dropout', unit: 'V', sample_rate_hz: 1000, sample_count: 2000, min: 0, max: 3, created: '' }],
      create: vi.fn(),
      fromCapture: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      play,
    }
    harness(vi.fn<BenchCall>(async () => ok()), library)
    fireEvent.click(screen.getByText('Fault'))
    fireEvent.click(await screen.findByText('Inject fault'))
    await waitFor(() => expect(play).toHaveBeenCalled())
    expect(play).toHaveBeenCalledWith('w1', { dac_path: '3v3', mapping: 'faithful', fault: { type: 'flatline', start: 1000, width: 200, level: 0 } })
  })

  it('routes the output, then arms the loop, then polls it', async () => {
    const call = vi.fn<BenchCall>(async (tool) => (tool === 'loop_probe' ? { text: '', structured: { i: 100, v: 32768, loop_input: 0 } } : ok()))
    harness(call)
    fireEvent.click(screen.getByText('Control loop'))
    fireEvent.click(screen.getByText('Start loop'))
    await screen.findByText(/out 1\.650 V/)
    expect(call.mock.calls[0]).toEqual(['dac_output', { path: '3v3', volts: 0 }])
    const [tool, args] = call.mock.calls[1]
    expect(tool).toBe('control_loop')
    expect(args).toMatchObject({ vmin: 0, vmax: valueToCode(3, '3v3'), k: 8192, tick_div: 64, source: 'adc' })
    expect((args!.curve as number[]).length).toBe(256)
    expect(call.mock.calls[2]).toEqual(['loop_probe', {}, { poll: true }])
  })
})

describe('LoopControls held input', () => {
  it('moves a running loop with loop_input after the slider settles', async () => {
    const call = vi.fn<BenchCall>(async (tool) => (tool === 'loop_probe' ? { text: '', structured: { i: 1, v: 0, loop_input: 0 } } : ok()))
    harness(call)
    fireEvent.click(screen.getByText('Control loop'))
    fireEvent.click(screen.getByText('Fixed'))
    fireEvent.click(screen.getByText('Start loop'))
    await waitFor(() => expect(call.mock.calls.some(([t]) => t === 'control_loop')).toBe(true))
    await screen.findByText('Re-arm')
    const slider = screen.getByRole('slider')
    slider.focus()
    fireEvent.keyDown(slider, { key: 'End' })
    await waitFor(() => expect(call.mock.calls.find(([t]) => t === 'loop_input')).toEqual(['loop_input', { source: 'fixed', input_code: 65535 }]))
  })
})
