import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Button, Group, NumberInput, SegmentedControl, Select, Slider, Stack, Text, TextInput } from '@mantine/core'
import { fmtSi } from '../results/AdcEnvelope'
import { benchData, type BenchCall, type BenchResult } from './benchCall'
import type { WaveformLibrary, WaveformMeta } from './GeneratorControls'
import {
  buildCurve,
  buildFault,
  codeToValue,
  curveAt,
  DEFAULT_SEGMENTS,
  loopRateHz,
  pathRange,
  percentToCode,
  responseToK,
  segmentsToSamples,
  sweepPlan,
  valueToCode,
  type CurveShape,
  type FaultType,
  type Segment,
  type SegmentShape,
} from './generatorMath'

// The rest of the web app's Generator tab for the bench panel: fault injection into a library
// waveform, the segment builder and the control loop. Host-neutral: every output is a BenchPod
// MCP tool call (replay with a fault, replay with built volts, control_loop and loop_input),
// so the host's confirmations and bench limits apply to them like to the agent's calls.

export type Run = (label: string, f: () => Promise<BenchResult>) => Promise<BenchResult>

const num = (v: string | number) => (typeof v === 'number' ? v : '')
const unitOf = (path: string) => (path === 'current_out' ? 'mA' : 'V')
/** mA in the forms, amps on the wire for the 4-20 mA output. */
const toWire = (v: number, path: string) => (path === 'current_out' ? v / 1000 : v)
const fromWire = (v: number, path: string) => (path === 'current_out' ? v * 1000 : v)

// --- Fault injection -------------------------------------------------------------------------

const FAULTS = [
  { value: 'flatline', label: 'Flatline' },
  { value: 'spike', label: 'Spike' },
  { value: 'stuck', label: 'Stuck' },
]

export function FaultControls({ library, output, run, busy, setError }: { library: WaveformLibrary; output: string; run: Run; busy: boolean; setError: (e: string | undefined) => void }) {
  const [items, setItems] = useState<WaveformMeta[] | null>(null)
  const [id, setId] = useState<string | null>(null)
  const [type, setType] = useState<FaultType>('flatline')
  const [start, setStart] = useState(50)
  const [width, setWidth] = useState(10)
  const [level, setLevel] = useState<number | ''>(output === 'current_out' ? 4 : 0)

  useEffect(() => {
    library.list().then(setItems, (e: Error) => setError(e.message))
  }, [library, setError])
  useEffect(() => setLevel(output === 'current_out' ? 4 : 0), [output])

  const wf = items?.find((w) => w.id === id) ?? items?.[0]
  const unit = unitOf(output)
  const r = pathRange(output)
  const scaled = !!wf && (wf.unit === 'mA') !== (output === 'current_out')
  const play = (withFault: boolean) => {
    if (!wf) return
    const mapping = scaled ? 'fit' : 'faithful'
    const fault = withFault ? buildFault(type, start, width, wf.sample_count, toWire(Number(level || 0), output), output) : undefined
    const at = `${fmtSi((wf.sample_count / wf.sample_rate_hz) * (start / 100), 's')}`
    void run(withFault ? `${wf.name} on ${output} with a ${type} from ${at}` : `playing ${wf.name} on ${output}`, () =>
      library.play(wf.id, { dac_path: output, mapping, ...(fault ? { fault } : {}) }),
    )
  }

  if (!items) return null
  if (!items.length)
    return (
      <Text size="xs" c="dimmed">
        Save a waveform to the library first (the Output tab: a capture or a CSV), then inject a fault into it here.
      </Text>
    )
  const durS = wf ? wf.sample_count / wf.sample_rate_hz : 0
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Replay a library waveform with a window replaced by a fault, so the board sees a dropout, a glitch or a jammed signal while the console and captures keep running.
      </Text>
      <Group gap="xs" align="flex-end">
        <Select size="xs" style={{ flex: 1 }} label="Waveform" data={items.map((w) => ({ value: w.id, label: w.name }))} value={wf?.id ?? null} onChange={setId} allowDeselect={false} />
        <SegmentedControl size="xs" data={FAULTS} value={type} onChange={(v) => setType(v as FaultType)} />
      </Group>
      <Group gap="md" grow>
        <Stack gap={2}>
          <Text size="xs">
            Start {start}% ({fmtSi(durS * (start / 100), 's')})
          </Text>
          <Slider size="sm" value={start} onChange={setStart} min={0} max={99} label={null} aria-label="Fault start" />
        </Stack>
        <Stack gap={2}>
          <Text size="xs">
            Width {width}% ({fmtSi(durS * (width / 100), 's')})
          </Text>
          <Slider size="sm" value={width} onChange={setWidth} min={1} max={100} label={null} aria-label="Fault width" />
        </Stack>
      </Group>
      {type !== 'stuck' ? (
        <NumberInput
          size="xs"
          w={160}
          label={`Level (${unit})`}
          description={`${fmtSi(fromWire(r.min, output), unit)} to ${fmtSi(fromWire(r.max, output), unit)} on ${output}`}
          value={level}
          onChange={(v) => setLevel(num(v))}
          step={0.1}
          decimalScale={4}
        />
      ) : null}
      <Text size="xs" c="dimmed">
        {type === 'flatline'
          ? `Holds ${level || 0} ${unit} over the window: a dead signal.`
          : type === 'spike'
            ? `Drives ${level || 0} ${unit} over the window: a glitch.`
            : 'Freezes the output at the value just before the window: a jammed signal.'}
        {scaled ? ' This waveform plays scaled to fill the output.' : ''}
      </Text>
      <Group gap="xs">
        <Button size="xs" color="grape" variant="light" disabled={busy || !wf || (type !== 'stuck' && level === '')} onClick={() => play(true)}>
          Inject fault
        </Button>
        <Button size="xs" variant="default" disabled={busy || !wf} onClick={() => play(false)}>
          Play clean
        </Button>
      </Group>
    </Stack>
  )
}

// --- Segment builder -------------------------------------------------------------------------

const SEG_SHAPES = [
  { value: 'ramp', label: 'Ramp' },
  { value: 'hold', label: 'Hold' },
  { value: 'step', label: 'Step' },
]

export function SegmentControls({ call, library, output, run, busy, setError }: { call: BenchCall; library?: WaveformLibrary; output: string; run: Run; busy: boolean; setError: (e: string | undefined) => void }) {
  const current = output === 'current_out'
  const [segs, setSegs] = useState<Segment[]>(() => (current ? currentSegments() : DEFAULT_SEGMENTS))
  const [name, setName] = useState('')
  const unit = unitOf(output)
  const built = useMemo(() => segmentsToSamples(segs), [segs])
  const r = pathRange(output)
  const lo = fromWire(r.min, output)
  const hi = fromWire(r.max, output)
  const outside = segs.some((s) => [s.vStart, s.vEnd].some((v) => v < lo - 1e-9 || v > hi + 1e-9))

  const set = (i: number, patch: Partial<Segment>) => setSegs((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const play = () =>
    run(`${segs.length} segments on ${output}, ${fmtSi(built.durationS, 's')} looping until Stop`, () =>
      call('replay', {
        volts: built.samples.map((v) => toWire(v, output)),
        dac_path: output,
        mapping: 'faithful',
        sample_rate_hz: built.rateHz,
      }),
    )
  const save = async () => {
    if (!library) return
    setError(undefined)
    try {
      await library.create({ name: name.trim(), unit: current ? 'mA' : 'V', sample_rate_hz: built.rateHz, samples: built.samples })
      setName('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        A signal from pieces: a ramp goes from start to end, a hold stays at its start, a step jumps to its end. It loops until Stop.
      </Text>
      {segs.map((s, i) => (
        <Group key={i} gap={4} wrap="nowrap" align="flex-end">
          <Select size="xs" w={78} label={i === 0 ? 'Shape' : undefined} data={SEG_SHAPES} value={s.shape} onChange={(v) => v && set(i, { shape: v as SegmentShape })} allowDeselect={false} aria-label={`Segment ${i + 1} shape`} />
          <NumberInput size="xs" w={80} label={i === 0 ? 'ms' : undefined} value={s.durationMs} onChange={(v) => set(i, { durationMs: Number(v) || 0 })} min={0.2} aria-label={`Segment ${i + 1} duration`} />
          <NumberInput size="xs" w={70} label={i === 0 ? `Start ${unit}` : undefined} value={s.vStart} onChange={(v) => set(i, { vStart: Number(v) || 0 })} step={0.1} decimalScale={4} disabled={s.shape === 'step'} aria-label={`Segment ${i + 1} start`} />
          <NumberInput size="xs" w={70} label={i === 0 ? `End ${unit}` : undefined} value={s.vEnd} onChange={(v) => set(i, { vEnd: Number(v) || 0 })} step={0.1} decimalScale={4} disabled={s.shape === 'hold'} aria-label={`Segment ${i + 1} end`} />
          <ActionIcon size="sm" variant="subtle" color="gray" mb={4} aria-label={`Remove segment ${i + 1}`} disabled={segs.length <= 1} onClick={() => setSegs((cur) => cur.filter((_, j) => j !== i))}>
            ✕
          </ActionIcon>
        </Group>
      ))}
      <Group gap="xs">
        <Button size="compact-xs" variant="subtle" onClick={() => setSegs((cur) => [...cur, { shape: 'hold', durationMs: 1000, vStart: cur.at(-1)?.vEnd ?? 0, vEnd: cur.at(-1)?.vEnd ?? 0 }])}>
          + Segment
        </Button>
        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSegs(current ? currentSegments() : DEFAULT_SEGMENTS)}>
          Reset
        </Button>
      </Group>
      <Text size="xs" c={outside ? 'red' : 'dimmed'} ff="monospace">
        {fmtSi(built.durationS, 's')} · {built.samples.length} samples at {fmtSi(built.rateHz, 'S/s')}
        {outside ? ` · values outside ${output} (${fmtSi(lo, unit)} to ${fmtSi(hi, unit)}) clip` : ''}
      </Text>
      <Group gap="xs" align="flex-end">
        <Button size="xs" variant="light" disabled={busy || !built.samples.length} onClick={() => void play()}>
          Play
        </Button>
        {library ? (
          <>
            <TextInput size="xs" style={{ flex: 1 }} placeholder="Name, to save it to the library" value={name} onChange={(e) => setName(e.currentTarget.value)} aria-label="Segment waveform name" />
            <Button size="xs" variant="default" disabled={!name.trim() || !built.samples.length} onClick={() => void save()}>
              Save
            </Button>
          </>
        ) : null}
      </Group>
    </Stack>
  )
}

function currentSegments(): Segment[] {
  return [
    { shape: 'ramp', durationMs: 2000, vStart: 4, vEnd: 20 },
    { shape: 'hold', durationMs: 2000, vStart: 20, vEnd: 20 },
    { shape: 'step', durationMs: 20, vStart: 20, vEnd: 12 },
    { shape: 'hold', durationMs: 2000, vStart: 12, vEnd: 12 },
  ]
}

// --- Control loop ----------------------------------------------------------------------------

const CURVES = [
  { value: 'panel', label: 'Droop with knee (I-V)' },
  { value: 'constant', label: 'Constant' },
  { value: 'linear-up', label: 'Linear rising' },
  { value: 'linear-down', label: 'Linear falling' },
]
const SOURCES = [
  { value: 'adc', label: 'ADC (closed)' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'sweep', label: 'Sweep' },
]
type Probe = { i: number; v: number; input_code?: number | null; source?: string | null; loop_input: number }

/**
 * The control loop in the FPGA: each tick out = curve[input], damped and clamped. The input is the
 * live ADC (closed loop), a held point or a sweep (open loop, to check the output on its own).
 */
export function LoopControls({ call, output, run, busy }: { call: BenchCall; output: string; run: Run; busy: boolean }) {
  const path = output === 'current_out' ? '3v3' : output
  const r = pathRange(path)
  const [shape, setShape] = useState<CurveShape>('panel')
  const [maxOut, setMaxOut] = useState<number | ''>(Math.min(3, r.max))
  const [knee, setKnee] = useState<number | ''>(6)
  const [vmin, setVmin] = useState<number | ''>(0)
  const [vmax, setVmax] = useState<number | ''>(Math.min(3, r.max))
  const [response, setResponse] = useState<number | ''>(25)
  const [tickDiv, setTickDiv] = useState<number | ''>(64)
  const [source, setSource] = useState('adc')
  const [inputPct, setInputPct] = useState(0)
  const pctRef = useRef(0)
  pctRef.current = inputPct
  const [sweepS, setSweepS] = useState<number | ''>(2)
  const [armed, setArmed] = useState(false)
  const [probe, setProbe] = useState<Probe | null>(null)

  // A new output starts from its own defaults.
  useEffect(() => {
    const top = Math.min(3, pathRange(path).max)
    setMaxOut(top)
    setVmax(top)
    setVmin(0)
  }, [path])

  const zero = valueToCode(0, path)
  const curve = useMemo(() => buildCurve(shape, valueToCode(Number(maxOut || 0), path), Number(knee || 6), zero), [shape, maxOut, knee, path, zero])
  const plan = sweepPlan(Number(sweepS || 0))
  const effDiv = source === 'sweep' ? plan.tickDiv : Number(tickDiv || 64)
  const error =
    vmin === '' || vmax === '' || Number(vmin) > Number(vmax)
      ? 'The clamp minimum must be at or below the maximum.'
      : !(Number(maxOut) > 0)
        ? 'The curve maximum must be above 0 V.'
        : Number(maxOut) > r.max
          ? `The curve maximum is above ${path}'s full scale (${r.max} V).`
          : undefined
  const expected = source === 'fixed' ? Math.max(valueToCode(Number(vmin), path), Math.min(valueToCode(Number(vmax), path), curveAt(curve, percentToCode(inputPct)))) : undefined

  const start = async () => {
    // Route the output first, at 0 V: the loop drives the output last routed.
    const routed = await run(`routing ${path}`, () => call('dac_output', { path, volts: 0 }))
    if (routed.is_error || routed.refused || routed.declined) return
    const res = await run(`control loop armed on ${path}`, () =>
      call('control_loop', {
        curve,
        k: responseToK(Number(response || 25)),
        vmin: valueToCode(Number(vmin), path),
        vmax: valueToCode(Number(vmax), path),
        tick_div: effDiv,
        source,
        input_code: percentToCode(inputPct),
        step: source === 'sweep' ? plan.step : 0,
      }),
    )
    if (!res.is_error && !res.refused && !res.declined) setArmed(true)
  }
  const stop = async () => {
    await run('control loop stopped', () => call('dac_stop', {}))
    setArmed(false)
    setProbe(null)
  }
  const retarget = (label: string, patch: { input_code?: number; source?: string }) => {
    if (!armed) return
    void run(label, () => call('loop_input', patch))
  }

  // A running loop with a held input follows the slider (a quarter second after it stops moving:
  // the slider's own onChangeEnd can report the value from before a click).
  const armedRef = useRef(false)
  armedRef.current = armed
  useEffect(() => {
    if (!armedRef.current || source !== 'fixed') return
    const t = setTimeout(() => retarget(`loop input held at ${inputPct}%`, { source: 'fixed', input_code: percentToCode(inputPct) }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputPct])

  // The live operating point while armed, every half second; a dropped poll is skipped.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const poll = useCallback(async () => {
    const res = await call('loop_probe', {}, { poll: true })
    const p = benchData<Probe>(res)
    if (p) setProbe(p)
  }, [call])
  useEffect(() => {
    if (!armed) return
    let live = true
    const tick = async () => {
      await poll()
      if (live) timer.current = setTimeout(() => void tick(), 500)
    }
    void tick()
    return () => {
      live = false
      clearTimeout(timer.current)
    }
  }, [armed, poll])

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        The FPGA reads an input every tick, looks it up in the curve, moves the output toward it and holds it inside the clamp. With the ADC as input it emulates a source that reacts to the board (a solar panel, a supply in foldback);
        Fixed and Sweep check the output on its own.
      </Text>
      {output === 'current_out' ? (
        <Text size="xs" c="orange">
          The control loop drives a voltage output: it runs on 3v3 here. Pick 5 V or 12 V above for those.
        </Text>
      ) : null}
      <Group gap="xs" align="flex-end">
        <Select size="xs" w={190} label="Curve" data={CURVES} value={shape} onChange={(v) => v && setShape(v as CurveShape)} allowDeselect={false} />
        <NumberInput size="xs" w={90} label="Max (V)" value={maxOut} onChange={(v) => setMaxOut(num(v))} step={0.1} decimalScale={3} />
        {shape === 'panel' ? <NumberInput size="xs" w={70} label="Knee" value={knee} onChange={(v) => setKnee(num(v))} min={1} max={64} /> : null}
      </Group>
      <Group gap="xs" align="flex-end">
        <NumberInput size="xs" w={90} label="Clamp min (V)" value={vmin} onChange={(v) => setVmin(num(v))} step={0.1} decimalScale={3} />
        <NumberInput size="xs" w={90} label="Clamp max (V)" value={vmax} onChange={(v) => setVmax(num(v))} step={0.1} decimalScale={3} />
        <NumberInput size="xs" w={90} label="Response (%)" value={response} onChange={(v) => setResponse(num(v))} min={1} max={100} />
        {source !== 'sweep' ? (
          <NumberInput size="xs" w={90} label="Tick divider" description={fmtSi(loopRateHz(Number(tickDiv || 64)), 'Hz')} value={tickDiv} onChange={(v) => setTickDiv(num(v))} min={8} max={65535} inputWrapperOrder={['label', 'input', 'description']} />
        ) : null}
      </Group>
      <Group gap="xs" align="flex-end">
        <Stack gap={2}>
          <Text size="xs" fw={500}>
            Input
          </Text>
          <SegmentedControl
            size="xs"
            data={SOURCES}
            value={source}
            onChange={(v) => {
              setSource(v)
              if (v !== 'sweep') retarget(v === 'adc' ? 'loop input: the ADC (closed loop)' : `loop input held at ${pctRef.current}%`, { source: v, input_code: percentToCode(pctRef.current) })
            }}
          />
        </Stack>
        {source === 'sweep' ? <NumberInput size="xs" w={110} label="Seconds per pass" value={sweepS} onChange={(v) => setSweepS(num(v))} min={0.001} disabled={armed} /> : null}
      </Group>
      {source === 'fixed' ? (
        <Stack gap={2}>
          <Text size="xs">
            Held input {inputPct}%{expected !== undefined ? `: the output settles at ${codeToValue(expected, path).toFixed(3)} V` : ''}
          </Text>
          <Slider
            size="sm"
            value={inputPct}
            onChange={setInputPct} min={0} max={100} label={null} thumbLabel="Held input" />
        </Stack>
      ) : null}
      {error ? (
        <Text size="xs" c="red">
          {error}
        </Text>
      ) : null}
      <Group gap="xs">
        <Button size="xs" variant="light" disabled={busy || !!error} onClick={() => void start()}>
          {armed ? 'Re-arm' : 'Start loop'}
        </Button>
        <Button size="xs" color="red" variant="subtle" disabled={busy || !armed} onClick={() => void stop()}>
          Stop loop
        </Button>
      </Group>
      {armed && probe ? (
        <Text size="xs" ff="monospace">
          out {codeToValue(probe.v, path).toFixed(3)} V · input {((probe.loop_input / 65535) * 100).toFixed(1)}% · ADC {probe.i}
        </Text>
      ) : null}
    </Stack>
  )
}
