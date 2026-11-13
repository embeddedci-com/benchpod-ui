import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Divider, Group, NumberInput, SegmentedControl, Stack, Table, Text } from '@mantine/core'
import { benchData, benchError, type BenchCall, type BenchResult } from './benchCall'

// The pod's calibration, the web app's Calibration section for a host's bench panel: what is
// stored, the ADC offset (nothing on J8), each DAC output's line from two DMM readings, and the ADC
// gains measured against those outputs. All through the MCP calibration tools.

type DacLine = { a: number; b: number; offset: number; gain_ppm: number } | null
type Calibration = {
  calibrated: boolean
  offset: number
  dac?: Record<string, DacLine>
  adc_gain_ppm?: Record<string, number | null>
  adc_low_gain_ppm?: number | null
  measured?: { v1: number; v2: number; r1: number; r2: number; residual: number } | null
}
type DacOut = { path: string; voltage: number | null; code16?: number | null }

/** Where the DMM flow drives each output: well inside its range, away from the floor near 0 V. */
export const DMM_SET_POINTS: Record<string, [number, number]> = {
  '3v3': [0.5, 3.0],
  '5v': [1.0, 4.0],
  '12v': [-5.0, 5.0],
}

const PATHS = ['3v3', '5v', '12v']
const ppm = (v: number | null | undefined) => (v == null ? 'built-in' : `${v >= 0 ? '+' : ''}${(v / 10000).toFixed(3)} %`)
const mv = (v: number) => `${v >= 0 ? '+' : ''}${(v * 1000).toFixed(2)} mV`

export function CalibrationControls({ call }: { call: BenchCall }) {
  const [cal, setCal] = useState<Calibration | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [info, setInfo] = useState<string | undefined>()
  const [j8Open, setJ8Open] = useState(false)
  // DMM flow
  const [path, setPath] = useState('5v')
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [codes, setCodes] = useState<[number, number]>([0, 0])
  const [reads, setReads] = useState<[number | '', number | '']>(['', ''])
  // ADC gain
  const [source, setSource] = useState('cal1')
  const [cable, setCable] = useState(false)
  // Clearing a DMM calibration cannot be undone here: a second click, whatever the host asks.
  const [clearing, setClearing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await call('calibration', {}, { poll: true })
    const c = benchData<Calibration>(r)
    if (c) setCal(c)
    else setError(benchError(r))
  }, [call])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (what: string, f: () => Promise<BenchResult>): Promise<BenchResult | undefined> => {
    setBusy(what)
    setError(undefined)
    setInfo(undefined)
    try {
      const r = await f()
      if (r.declined) return undefined
      const e = benchError(r)
      if (e) {
        setError(e)
        return undefined
      }
      return r
    } finally {
      setBusy(null)
    }
  }

  const offset = async () => {
    const r = await run('offset', () => call('calibrate', { source: 'current_in' }))
    if (r) {
      setInfo('ADC offset measured and stored.')
      await load()
    }
  }

  /** Drive set point i of the chosen output, for the DMM to read. */
  const drive = async (i: 0 | 1) => {
    const r = await run('drive', () => call('dac_output', { path, volts: DMM_SET_POINTS[path][i] }))
    const d = r && benchData<DacOut>(r)
    if (d?.code16 == null) {
      if (r) setError('this firmware does not report the 16-bit code: update the pod first')
      return
    }
    setCodes((c) => (i === 0 ? [d.code16 as number, c[1]] : [c[0], d.code16 as number]))
    setStep(i === 0 ? 1 : 2)
  }

  const storeLine = async () => {
    const [v1, v2] = reads
    if (v1 === '' || v2 === '') return
    const r = await run('line', () => call('calibrate_dac', { path, code1: codes[0], volts1: v1, code2: codes[1], volts2: v2 }))
    await call('dac_output', { path: 'off' })
    if (r) {
      setInfo(`${path} line stored from your DMM.`)
      setStep(0)
      setReads(['', ''])
      await load()
    }
  }

  const cancelLine = async () => {
    setStep(0)
    setReads(['', ''])
    await call('dac_output', { path: 'off' })
  }

  const gain = async () => {
    const args = source === 'low' ? { source: 'cal1', range: 'low' } : { source }
    const r = await run('gain', () => call('calibrate_adc_gain', args))
    if (r) {
      const m = benchData<Calibration>(r)?.measured
      setInfo(m ? `Gain stored. The DAC put out ${m.v1.toFixed(4)} V and ${m.v2.toFixed(4)} V; ${mv(m.residual)} offset left.` : 'Gain stored.')
      await load()
    }
  }

  const clear = async (part: string) => {
    const r = await run('clear', () => call('calibrate', { source: 'current_in', clear: true, clear_part: part }))
    if (r) {
      setInfo(`Cleared: the pod uses its built-in ${part === 'offset' ? 'offset' : part === 'dac' ? 'DAC lines' : 'ADC gains'} again.`)
      await load()
    }
  }

  const needsLine = source === 'cal1' || source === 'low' ? '5v' : '12v'

  return (
    <Stack gap="sm" p="sm">
      <Text fw={600}>Calibration</Text>
      {cal ? (
        <Table fz="xs" verticalSpacing={4}>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td c="dimmed" w={170}>
                ADC offset (J8 open)
              </Table.Td>
              <Table.Td>{cal.calibrated ? mv(cal.offset) : 'built-in'}</Table.Td>
            </Table.Tr>
            {PATHS.map((p) => (
              <Table.Tr key={p}>
                <Table.Td c="dimmed">DAC {p} line</Table.Td>
                <Table.Td>{cal.dac?.[p] ? `${mv(cal.dac[p]!.offset)}, gain ${ppm(cal.dac[p]!.gain_ppm)}` : 'built-in'}</Table.Td>
              </Table.Tr>
            ))}
            {['cal1', 'cal2', 'ext'].map((s) => (
              <Table.Tr key={s}>
                <Table.Td c="dimmed">ADC gain {s}</Table.Td>
                <Table.Td>{ppm(cal.adc_gain_ppm?.[s])}</Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td c="dimmed">ADC low range gain</Table.Td>
              <Table.Td>{ppm(cal.adc_low_gain_ppm)}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      ) : null}

      <Divider label="ADC offset" labelPosition="left" />
      <Group gap="xs">
        <Checkbox size="xs" label="Nothing is connected to J8" checked={j8Open} onChange={(e) => setJ8Open(e.currentTarget.checked)} />
        <Button size="xs" variant="light" disabled={!j8Open || !!busy} loading={busy === 'offset'} onClick={() => void offset()}>
          Measure offset
        </Button>
      </Group>

      <Divider label="DAC outputs, with a DMM" labelPosition="left" />
      <Text size="xs" c="dimmed">
        Connect a DMM to the output, then let the pod drive two set points and type what the DMM reads. The pod stores its own line for that
        output; the ADC gains below are measured against it.
      </Text>
      <Group gap="xs" align="flex-end">
        <SegmentedControl size="xs" data={PATHS} value={path} onChange={(v) => step === 0 && setPath(v)} disabled={step !== 0} />
        {step === 0 ? (
          <Button size="xs" variant="light" onClick={() => void drive(0)} loading={busy === 'drive'} disabled={!!busy}>
            Drive {DMM_SET_POINTS[path][0]} V
          </Button>
        ) : null}
      </Group>
      {step >= 1 ? (
        <Group gap="xs" align="flex-end">
          <NumberInput size="xs" w={150} label={`DMM at ${DMM_SET_POINTS[path][0]} V`} value={reads[0]} onChange={(v) => setReads((r) => [typeof v === 'number' ? v : '', r[1]])} decimalScale={5} hideControls />
          {step === 1 ? (
            <Button size="xs" variant="light" onClick={() => void drive(1)} loading={busy === 'drive'} disabled={reads[0] === '' || !!busy}>
              Drive {DMM_SET_POINTS[path][1]} V
            </Button>
          ) : (
            <NumberInput size="xs" w={150} label={`DMM at ${DMM_SET_POINTS[path][1]} V`} value={reads[1]} onChange={(v) => setReads((r) => [r[0], typeof v === 'number' ? v : ''])} decimalScale={5} hideControls />
          )}
          {step === 2 ? (
            <Button size="xs" onClick={() => void storeLine()} loading={busy === 'line'} disabled={reads[1] === '' || !!busy}>
              Store the line
            </Button>
          ) : null}
          <Button size="xs" variant="default" onClick={() => void cancelLine()} disabled={!!busy}>
            Cancel
          </Button>
        </Group>
      ) : null}

      <Divider label="ADC gains" labelPosition="left" />
      <Group gap="xs" align="flex-end">
        <SegmentedControl
          size="xs"
          value={source}
          onChange={setSource}
          data={[
            { value: 'cal1', label: 'cal1' },
            { value: 'cal2', label: 'cal2' },
            { value: 'ext', label: 'SMA' },
            { value: 'low', label: 'Low range' },
          ]}
        />
        <Button size="xs" variant="light" onClick={() => void gain()} loading={busy === 'gain'} disabled={!!busy || (source === 'ext' && !cable)}>
          Measure gain
        </Button>
      </Group>
      {source === 'ext' ? <Checkbox size="xs" label="An SMA cable connects the ±12 V output to the ADC input" checked={cable} onChange={(e) => setCable(e.currentTarget.checked)} /> : null}
      <Text size="xs" c="dimmed">
        Uses the pod's own {needsLine} output, which needs its DMM line first. The pod drives two points and switches the outputs off after.
      </Text>

      <Group gap="xs">
        <Text size="xs" c="dimmed">
          Back to built-in:
        </Text>
        {['offset', 'dac', 'adc'].map((p) => (
          <Button
            key={p}
            size="compact-xs"
            variant={clearing === p ? 'light' : 'subtle'}
            color={clearing === p ? 'red' : 'gray'}
            onClick={() => {
              if (clearing !== p) return setClearing(p)
              setClearing(null)
              void clear(p)
            }}
            onBlur={() => setClearing((c) => (c === p ? null : c))}
            disabled={!!busy}
          >
            {clearing === p ? 'click again to clear' : p === 'offset' ? 'offset' : p === 'dac' ? 'DAC lines' : 'ADC gains'}
          </Button>
        ))}
      </Group>

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : info ? (
        <Text size="xs" c="teal">
          {info}
        </Text>
      ) : null}
    </Stack>
  )
}
