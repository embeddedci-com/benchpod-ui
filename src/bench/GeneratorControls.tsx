import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Alert, Button, Divider, FileButton, Group, NumberInput, SegmentedControl, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { fmtSi } from '../results/AdcEnvelope'
import { benchError, type BenchCall, type BenchResult } from './benchCall'

// The DAC by hand: a DC level, a sine, square or sawtooth, a waveform from the library, and Stop.
// The web app's Generator tab for a host's bench panel. The library is the host's (the desktop
// app keeps it in its data folder); the outputs go through the BenchPod MCP tools and so through
// the host's confirmations and limits.

export type WaveformMeta = {
  id: string
  name: string
  /** V, or mA for a recording of the 4-20 mA input. */
  unit: 'V' | 'mA'
  sample_rate_hz: number
  sample_count: number
  min: number
  max: number
  created: string
}

export type WaveformLibrary = {
  list(): Promise<WaveformMeta[]>
  create(w: { name: string; unit: 'V' | 'mA'; sample_rate_hz: number; samples: number[] }): Promise<WaveformMeta>
  /** Store the last ADC capture under name. */
  fromCapture(name: string): Promise<WaveformMeta>
  rename(id: string, name: string): Promise<WaveformMeta>
  remove(id: string): Promise<void>
  /** Loop it out of the DAC until Stop. */
  play(id: string, opts: { dac_path: string; mapping: 'faithful' | 'fit' }): Promise<BenchResult>
}

const OUTPUTS = [
  { value: '3v3', label: '3.3 V output (0 to 3.3 V)' },
  { value: '5v', label: '5 V output (0 to 5 V)' },
  { value: '12v', label: '12 V output (±12 V)' },
  { value: 'current_out', label: '4-20 mA output (J9)' },
]
const SHAPES = [
  { value: 'sine', label: 'Sine' },
  { value: 'square', label: 'Square' },
  { value: 'sawtooth', label: 'Sawtooth' },
]

/** Parse a CSV or a list of numbers: the last number on each line is the value; a first column
 * that rises evenly is time in seconds and gives the rate. */
export function parseWaveformCsv(text: string): { samples: number[]; rateHz?: number } {
  const samples: number[] = []
  const times: number[] = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,;\t ]+/).filter(Boolean).map(Number)
    if (!cells.length || cells.some((c) => Number.isNaN(c))) continue
    samples.push(cells[cells.length - 1])
    if (cells.length >= 2) times.push(cells[0])
  }
  let rateHz: number | undefined
  if (times.length === samples.length && times.length > 2) {
    const dt = (times[times.length - 1] - times[0]) / (times.length - 1)
    if (dt > 0) rateHz = 1 / dt
  }
  return { samples, rateHz }
}

export function GeneratorControls({ call, library }: { call: BenchCall; library?: WaveformLibrary }) {
  const [output, setOutput] = useState('3v3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [info, setInfo] = useState<string | undefined>()
  const [dc, setDc] = useState<number | ''>(1)
  const [shape, setShape] = useState('sine')
  const [freq, setFreq] = useState<number | ''>(1000)
  const [amp, setAmp] = useState<number | ''>(1)
  const [offset, setOffset] = useState<number | ''>(1.65)
  const [duration, setDuration] = useState<number | ''>(0)
  const current = output === 'current_out'
  const unit = current ? 'mA' : 'V'

  const run = useCallback(
    async (label: string, f: () => Promise<BenchResult>) => {
      setBusy(true)
      setError(undefined)
      setInfo(undefined)
      try {
        const r = await f()
        const e = benchError(r)
        if (e) setError(e)
        else if (!r.declined) setInfo(label)
        return r
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  // mA in the form, amps on the wire for the 4-20 mA output.
  const toWire = (v: number) => (current ? v / 1000 : v)

  const setLevel = () =>
    run(current ? `holding ${dc} mA` : `driving ${dc} V on ${output}`, () =>
      current ? call('current_out', { current: toWire(Number(dc)) }) : call('dac_output', { path: output, volts: Number(dc) }),
    )

  const generate = () =>
    run(`${shape} ${fmtSi(Number(freq), 'Hz')} on ${output}${duration ? ` for ${duration} s` : ', until Stop'}`, () =>
      call('generate', {
        waveform: shape,
        freq_hz: Number(freq),
        amplitude: toWire(Number(amp)),
        offset: toWire(Number(offset)),
        dac_path: output,
        ...(duration ? { duration: Number(duration) } : {}),
      }),
    )

  const stop = () =>
    run(current ? 'stopped: the loop stays where it was, set 4 mA to go back' : 'stopped', () => call('dac_stop', {}))

  return (
    <Stack gap="sm" p="sm">
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Select size="xs" style={{ flex: 1 }} label="Output" data={OUTPUTS} value={output} onChange={(v) => v && setOutput(v)} allowDeselect={false} />
        <Button size="xs" color="red" variant="light" onClick={() => void stop()} disabled={busy}>
          Stop
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {current
          ? 'The 4-20 mA output needs a loop supply on J9; nothing in the loop may touch pod ground.'
          : 'Pick the output the board pin tolerates: 5 V and 12 V can damage a 3.3 V pin.'}
      </Text>

      <Divider label="Level" labelPosition="left" />
      <Group gap="xs" align="flex-end">
        <NumberInput size="xs" w={120} label={current ? 'Current (mA)' : 'Voltage (V)'} value={dc} onChange={(v) => setDc(typeof v === 'number' ? v : '')} step={0.1} decimalScale={4} />
        <Button size="xs" variant="light" onClick={() => void setLevel()} disabled={busy || dc === ''}>
          Set
        </Button>
      </Group>

      <Divider label="Waveform" labelPosition="left" />
      <SegmentedControl size="xs" data={SHAPES} value={shape} onChange={setShape} />
      <Group gap="xs" align="flex-end">
        <NumberInput size="xs" w={100} label="Freq (Hz)" value={freq} onChange={(v) => setFreq(typeof v === 'number' ? v : '')} min={0.01} />
        <NumberInput size="xs" w={100} label={`Peak (${unit})`} value={amp} onChange={(v) => setAmp(typeof v === 'number' ? v : '')} step={0.1} decimalScale={4} />
        <NumberInput size="xs" w={100} label={current ? 'Center (mA)' : 'Offset (V)'} value={offset} onChange={(v) => setOffset(typeof v === 'number' ? v : '')} step={0.1} decimalScale={4} />
        <NumberInput size="xs" w={100} label="Seconds" description="0 = until Stop" value={duration} onChange={(v) => setDuration(typeof v === 'number' ? v : '')} min={0} />
        <Button size="xs" variant="light" onClick={() => void generate()} disabled={busy || !freq || !amp}>
          Play
        </Button>
      </Group>

      {library ? <Library library={library} output={output} run={run} busy={busy} setError={setError} /> : null}

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : info ? (
        <Text size="xs" c="dimmed" ff="monospace">
          {info}
        </Text>
      ) : null}
    </Stack>
  )
}

function Library({
  library,
  output,
  run,
  busy,
  setError,
}: {
  library: WaveformLibrary
  output: string
  run: (label: string, f: () => Promise<BenchResult>) => Promise<BenchResult>
  busy: boolean
  setError: (e: string | undefined) => void
}) {
  const [items, setItems] = useState<WaveformMeta[]>([])
  const [name, setName] = useState('')
  const [rate, setRate] = useState<number | ''>(10000)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [fit, setFit] = useState(false)

  const reload = useCallback(async () => {
    try {
      setItems(await library.list())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [library, setError])
  useEffect(() => {
    void reload()
  }, [reload])

  const guard = async (f: () => Promise<unknown>) => {
    setError(undefined)
    try {
      await f()
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const importFile = (file: File | null) => {
    if (!file) return
    void guard(async () => {
      const { samples, rateHz } = parseWaveformCsv(await file.text())
      if (samples.length < 2) throw new Error(`${file.name}: no numbers found (one value per line, or time,value)`)
      await library.create({ name: name.trim() || file.name.replace(/\.[^.]+$/, ''), unit: 'V', sample_rate_hz: rateHz ?? Number(rate || 10000), samples })
      setName('')
    })
  }

  return (
    <Stack gap={6}>
      <Divider label="Library" labelPosition="left" />
      <Group gap="xs" align="flex-end">
        <TextInput size="xs" style={{ flex: 1 }} label="Name" placeholder="e.g. sensor dropout" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Tooltip label="Save the last analog capture (the capture view's or the agent's)">
          <Button size="xs" variant="light" disabled={!name.trim()} onClick={() => void guard(async () => (await library.fromCapture(name.trim()), setName('')))}>
            Save last capture
          </Button>
        </Tooltip>
        <NumberInput size="xs" w={90} label="CSV rate (Hz)" value={rate} onChange={(v) => setRate(typeof v === 'number' ? v : '')} min={1} max={1_000_000} />
        <FileButton onChange={importFile} accept=".csv,.txt">
          {(props) => (
            <Button size="xs" variant="default" {...props}>
              Import CSV
            </Button>
          )}
        </FileButton>
      </Group>
      <Text size="xs" c="dimmed">
        Waveforms stay on this computer. Play loops one out of the output above until Stop
        {fit ? ', scaled to fill the output' : ', at the values it was recorded with'}.{' '}
        <Text span size="xs" c="blue" style={{ cursor: 'pointer' }} onClick={() => setFit(!fit)}>
          {fit ? 'Play as recorded' : 'Scale to the output'}
        </Text>
      </Text>
      {items.length === 0 ? (
        <Text size="xs" c="dimmed">
          No waveforms yet.
        </Text>
      ) : (
        items.map((w) => (
          <Group key={w.id} gap="xs" wrap="nowrap" justify="space-between">
            {editing?.id === w.id ? (
              <TextInput
                size="xs"
                style={{ flex: 1 }}
                value={editing.name}
                autoFocus
                aria-label="New name"
                onChange={(e) => setEditing({ id: w.id, name: e.currentTarget.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void guard(async () => (await library.rename(w.id, editing.name), setEditing(null)))
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" truncate>
                  {w.name}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {fmtSi(w.sample_count / w.sample_rate_hz, 's')} · {fmtSi(w.min, w.unit)} to {fmtSi(w.max, w.unit)} · {fmtSi(w.sample_rate_hz, 'S/s')}
                </Text>
              </Stack>
            )}
            <Group gap={4} wrap="nowrap">
              <Button
                size="compact-xs"
                variant="light"
                disabled={busy}
                onClick={() => {
                  // A recording in mA on a voltage output, or in V on the 4-20 mA output, can only
                  // play scaled to the output.
                  const scaled = fit || (w.unit === 'mA') !== (output === 'current_out')
                  void run(`playing ${w.name} on ${output}${scaled ? ', scaled to fill it' : ''}`, () =>
                    library.play(w.id, { dac_path: output, mapping: scaled ? 'fit' : 'faithful' }),
                  )
                }}
              >
                Play
              </Button>
              <Tooltip label="Rename">
                <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Rename ${w.name}`} onClick={() => setEditing({ id: w.id, name: w.name })}>
                  ✎
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Delete">
                <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Delete ${w.name}`} onClick={() => void guard(() => library.remove(w.id))}>
                  ✕
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        ))
      )}
    </Stack>
  )
}
