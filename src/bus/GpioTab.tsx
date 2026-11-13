import { useState } from 'react'
import { Alert, Button, Checkbox, Divider, Group, NumberInput, Select, Stack, Text } from '@mantine/core'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'
import { fmtSi } from './busLog'
import type { SendCapture } from './sendCapture'

// LA channels as GPIO, by hand: claim a pin (output, open drain, input), drive it, read it, pulse
// it, wait for a level, release it. The tools are gpio_mode, gpio_write, gpio_read, gpio_pulse,
// gpio_wait and gpio_release; the pod checks pin conflicts and directions.

type Levels = { levels: { la: number; level: number }[] }
type Wait = { la: number; level: number; reached: boolean; waited: number }

const LA = Array.from({ length: 14 }, (_, i) => ({ value: String(i + 1), label: `LA${i + 1}` }))
const MODES = [
  { value: 'output', label: 'Output' },
  { value: 'open_drain', label: 'Open drain' },
  { value: 'input', label: 'Input' },
]

export function GpioTab({
  call,
  names,
  sendCapture,
  onChange,
}: {
  call: BenchCall
  names?: string[]
  /** Send and capture (the dashboard's): with it, Write 0 and Write 1 can capture the edge. */
  sendCapture?: SendCapture
  onChange?: () => void
}) {
  const [la, setLa] = useState<string>('1')
  const [mode, setMode] = useState('output')
  const [widthMs, setWidthMs] = useState<number | ''>(1)
  const [count, setCount] = useState<number | ''>(1)
  const [waitLevel, setWaitLevel] = useState('1')
  const [timeout, setTimeoutS] = useState<number | ''>(5)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<string | null>(null)
  const [capture, setCapture] = useState(false)

  const data = LA.map((o, i) => ({ ...o, label: names?.[i] ? `${o.label} ${names[i]}` : o.label }))
  const ch = Number(la)

  const run = async <T,>(what: string, tool: string, args: Record<string, unknown>): Promise<T | undefined> => {
    setBusy(what)
    setError(undefined)
    setResult(null)
    try {
      const r = await call(tool, args)
      const e = benchError(r)
      if (e) setError(e)
      return benchData<T>(r)
    } finally {
      setBusy(null)
      onChange?.()
    }
  }

  const read = async () => {
    const r = await run<Levels>('read', 'gpio_read', { la: [ch] })
    const l = r?.levels.find((x) => x.la === ch)
    if (l) setResult(`LA${ch} reads ${l.level}`)
  }
  const wait = async () => {
    const r = await run<Wait>('wait', 'gpio_wait', { la: ch, level: Number(waitLevel), timeout: Number(timeout) || 0 })
    if (r) setResult(r.reached ? `LA${ch} reached ${r.level} after ${fmtSi(r.waited, 's')}` : `LA${ch} was still not ${r.level} after ${fmtSi(r.waited, 's')}`)
  }
  const width = (Number(widthMs) || 0) / 1000

  const write = async (level: 0 | 1) => {
    if (!(capture && sendCapture)) {
      await run(`w${level}`, 'gpio_write', { la: [ch], level })
      return
    }
    setBusy(`w${level}`)
    setError(undefined)
    setResult(null)
    try {
      const o = await sendCapture({ bus: 'gpio', la: ch, level })
      if (o.error) setError(o.error)
      else if (o.send) setResult(`LA${ch} set to ${level}, captured`)
    } finally {
      setBusy(null)
      onChange?.()
    }
  }

  return (
    <Stack gap="xs" p="sm">
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select size="xs" w={140} label="Pin" data={data} value={la} onChange={(v) => v && setLa(v)} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
        <Select size="xs" w={112} label="Mode" data={MODES} value={mode} onChange={(v) => v && setMode(v)} allowDeselect={false} />
        <Button size="xs" onClick={() => void run('mode', 'gpio_mode', { la: [ch], mode })} loading={busy === 'mode'} disabled={!!busy}>
          Set mode
        </Button>
        <Button size="xs" variant="default" onClick={() => void run('release', 'gpio_release', { la: [ch] })} loading={busy === 'release'} disabled={!!busy}>
          Release
        </Button>
      </Group>
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Button size="xs" variant="light" onClick={() => void write(0)} loading={busy === 'w0'} disabled={!!busy}>
          Write 0
        </Button>
        <Button size="xs" variant="light" onClick={() => void write(1)} loading={busy === 'w1'} disabled={!!busy}>
          Write 1
        </Button>
        <Button size="xs" variant="light" onClick={() => void read()} loading={busy === 'read'} disabled={!!busy}>
          Read
        </Button>
        {sendCapture ? <Checkbox size="xs" label="Capture it" checked={capture} onChange={(e) => setCapture(e.currentTarget.checked)} mb={4} /> : null}
      </Group>
      <Text size="xs" c="dimmed">
        Open drain: 0 pulls the pin low, 1 lets it go. Read works on any pin, whatever owns it.
        {capture && sendCapture ? ' Capture it: the pin must be an output already; the trace starts just before its edge.' : ''}
      </Text>

      <Divider label="Pulse" labelPosition="left" />
      <Group gap="xs" align="flex-end" wrap="wrap">
        <NumberInput size="xs" w={104} label="Width (ms)" value={widthMs} onChange={(v) => setWidthMs(typeof v === 'number' ? v : '')} min={0.004} max={65.535} step={0.1} decimalScale={3} />
        <NumberInput size="xs" w={84} label="Count" value={count} onChange={(v) => setCount(typeof v === 'number' ? v : '')} min={1} max={65535} />
        <Button size="xs" variant="light" onClick={() => void run('pulse', 'gpio_pulse', { la: ch, width, count: Number(count) || 1 })} loading={busy === 'pulse'} disabled={!!busy || !width}>
          Pulse
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        High for the width, low for the width between pulses. The pin must be free or an output at 0.
      </Text>

      <Divider label="Wait for a level" labelPosition="left" />
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select size="xs" w={70} label="Level" data={['0', '1']} value={waitLevel} onChange={(v) => v && setWaitLevel(v)} allowDeselect={false} />
        <NumberInput size="xs" w={96} label="Up to (s)" value={timeout} onChange={(v) => setTimeoutS(typeof v === 'number' ? v : '')} min={0} max={600} />
        <Button size="xs" variant="light" onClick={() => void wait()} loading={busy === 'wait'} disabled={!!busy}>
          Wait
        </Button>
      </Group>

      {result ? (
        <Text size="xs" ff="monospace" data-testid="gpio-result">
          {result}
        </Text>
      ) : null}
      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}
    </Stack>
  )
}
