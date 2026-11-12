import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { convertSource } from '../convert'
import { engineErrorText, type Engine } from '../engine'
import { FAULT_TYPES, SEGMENT_SHAPES, newSegment, shapeInfo, type SegmentShape } from '../model'
import type { PodSensorStatus, SensorPod } from '../pod'
import type { SensorStore, StoredDefinition } from '../store'
import { lineOfPath, toYaml, type YamlValue } from '../yaml'
import { CodeEditor } from './CodeEditor'
import type { FileHost } from './files'
import { LineChart, type ChartWindow } from './LineChart'
import type { RunBlock } from './RunPanel'

type Doc = { [k: string]: YamlValue }
type Seg = { [k: string]: YamlValue }

const isObj = (v: YamlValue | undefined): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v)

/** The stimulus editor: signals as segment lists, faults, a chart of both, start and stop on the pod. */
export function StimulusEditor({
  initial,
  store,
  engine,
  pod,
  block,
  status,
  files,
  paramSuggestions = [],
  onBack,
  onSaved,
  onStatusChanged,
}: {
  initial: { id?: string; source: string }
  store: SensorStore
  engine: Engine | null
  pod: SensorPod | null
  block: RunBlock
  status: PodSensorStatus | null
  files: FileHost
  paramSuggestions?: string[]
  onBack: () => void
  onSaved: (d: StoredDefinition) => void
  onStatusChanged: () => void
}) {
  const first = convertSource(initial.source)
  const [mode, setMode] = useState<'form' | 'text'>(first.ok ? 'form' : 'text')
  const [doc, setDoc] = useState<Doc>(first.ok ? first.doc : { format: 1, kind: 'stimulus', signals: {} })
  const [text, setText] = useState(initial.source)
  const [formTouched, setFormTouched] = useState(false)
  const [id, setId] = useState(initial.id ?? null)
  const [savedSource, setSavedSource] = useState(initial.id ? initial.source : null)
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const source = mode === 'text' ? text : formTouched ? toYaml(doc) : text
  const parsed = useMemo(() => convertSource(source), [source])
  const json = parsed.ok ? parsed.json : null
  const check = useMemo(() => (json && engine ? engine.stimulusValidate(json) : null), [json, engine])
  const duration = check && check.ok ? check.duration_s : 0
  const sample = useMemo(() => {
    if (!json || !engine || !check?.ok || !(duration > 0)) return null
    const step = Math.max(duration / 600, 0.001)
    return engine.stimulusSample(json, 0, duration, step)
  }, [json, engine, check, duration])
  const error = !parsed.ok ? parsed.error : check && !check.ok ? engineErrorText(check) : sample && !sample.ok ? engineErrorText(sample) : null
  const errorLine = !parsed.ok ? parsed.line : check && !check.ok ? lineOfPath(parsed.locs, check.path) : null

  const edit = (fn: (d: Doc) => void) => {
    const next = structuredClone(doc)
    fn(next)
    setDoc(next)
    setFormTouched(true)
  }
  const switchMode = (m: string) => {
    if (m === 'text') {
      setText(source)
      setMode('text')
      return
    }
    const c = convertSource(text)
    if (!c.ok) {
      setMsg({ color: 'red', text: `Fix the text first: ${c.error}` })
      return
    }
    setDoc(c.doc)
    setFormTouched(false)
    setMode('form')
  }

  const signals = isObj(doc.signals) ? doc.signals : {}
  const faults = Array.isArray(doc.faults) ? (doc.faults as Seg[]) : []
  const name = typeof doc.name === 'string' ? doc.name : ''

  const save = async () => {
    setBusy('save')
    setMsg(null)
    try {
      const d = await store.save(source, id ?? undefined)
      setId(d.id)
      setSavedSource(source)
      setMsg({ color: 'green', text: 'Saved.' })
      onSaved(d)
    } catch (e) {
      setMsg({ color: 'red', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const load = async () => {
    const [f] = await files.open({ accept: '.yaml,.yml,.json' })
    if (!f) return
    const t = await f.text()
    setText(t)
    const c = convertSource(t)
    if (c.ok) {
      setDoc(c.doc)
      setFormTouched(false)
      setMode('form')
    } else setMode('text')
  }
  const runOnPod = async () => {
    if (!pod || !json) return
    setBusy('start')
    setMsg(null)
    try {
      await pod.stimulus(json)
      await pod.stimulusStart()
      setMsg({ color: 'green', text: 'Stimulus running on the pod.' })
    } catch (e) {
      setMsg({ color: 'red', text: (e as Error).message })
    } finally {
      setBusy(null)
      onStatusChanged()
    }
  }
  const stopOnPod = async () => {
    if (!pod) return
    setBusy('stop')
    try {
      await pod.stimulusStop()
    } catch (e) {
      setMsg({ color: 'red', text: (e as Error).message })
    } finally {
      setBusy(null)
      onStatusChanged()
    }
  }

  const windows: ChartWindow[] = sample && sample.ok ? sample.faults.flatMap((f) => f.windows.map(([from, to]) => ({ from, to, label: f.type }))) : []
  const stim = status?.stimulus
  const runBlock = block ?? (!pod ? 'No pod' : !json || error ? 'Fix the stimulus first' : (status?.instances.filter((i) => i.running).length ?? 0) === 0 ? 'Start a sensor first' : null)

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button variant="subtle" size="xs" onClick={onBack}>
            Back
          </Button>
          <Title order={4}>{name || 'New stimulus'}</Title>
          {source !== savedSource && (
            <Badge color="yellow" variant="light">
              unsaved
            </Badge>
          )}
          {stim?.loaded && (
            <Badge color={stim.running ? 'green' : 'gray'} variant="light">
              {stim.running ? `on the pod, t = ${(stim.t_s ?? 0).toFixed(1)} s` : 'loaded on the pod'}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={switchMode}
            data={[
              { value: 'form', label: 'Segments' },
              { value: 'text', label: 'YAML' },
            ]}
          />
          <Button size="xs" variant="default" onClick={load}>
            Open file
          </Button>
          <Button size="xs" variant="default" onClick={() => files.save({ blob: new Blob([source], { type: 'text/plain' }), filename: `${name || 'stimulus'}.yaml` })}>
            Download
          </Button>
          <Button size="xs" onClick={save} loading={busy === 'save'} disabled={!parsed.ok}>
            Save
          </Button>
        </Group>
      </Group>

      {msg && (
        <Alert color={msg.color} variant="light" withCloseButton onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <Card withBorder radius="md" padding="md">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600}>Chart</Text>
            <Text size="xs" c="dimmed">
              {check && check.ok ? `${check.duration_s} s, ${check.signals.length} signal${check.signals.length === 1 ? '' : 's'}, ${check.rate_hz} updates per second${check.repeat ? ', repeats' : ''}` : ''}
            </Text>
          </Group>
          <LineChart
            ariaLabel="Stimulus chart"
            x={sample && sample.ok ? sample.t : []}
            series={sample && sample.ok ? sample.signals.map((s) => ({ name: s.name, y: s.values })) : []}
            windows={windows}
            separateY
            height={220}
            placeholder={error ? 'Fix the error to see the chart.' : 'Add a segment to see the chart.'}
          />
          {sample && sample.ok && sample.signals.length > 0 && (
            <Group gap="sm">
              {sample.signals.map((s, i) => (
                <SignalKey key={s.name} name={s.name} index={i} />
              ))}
              {windows.length > 0 && (
                <Text size="xs" c="red">
                  Red: fault windows
                </Text>
              )}
            </Group>
          )}
          {error && (
            <Text size="sm" c="red" aria-label="Validation error">
              {errorLine ? `Line ${errorLine}: ` : ''}
              {error}
            </Text>
          )}
        </Stack>
      </Card>

      {mode === 'text' ? (
        <CodeEditor value={text} onChange={setText} errorLine={errorLine} ariaLabel="Stimulus source" />
      ) : (
        <Stack gap="md">
          <Group gap="md" align="flex-end">
            <TextInput label="Name" w={220} value={name} onChange={(e) => edit((d) => void (d.name = e.currentTarget.value))} />
            <NumberInput
              label="Updates per second"
              w={160}
              min={1}
              max={100}
              value={typeof doc.rate_hz === 'number' ? doc.rate_hz : 50}
              onChange={(v) => typeof v === 'number' && edit((d) => void (d.rate_hz = v))}
            />
            <Switch label="Repeat" checked={doc.repeat === true} onChange={(e) => edit((d) => void (d.repeat = e.currentTarget.checked))} mb={8} />
          </Group>
          {Object.entries(signals).map(([sig, segs]) => (
            <Card key={sig} withBorder radius="md" padding="sm" aria-label={`Signal ${sig}`}>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Autocomplete
                    size="xs"
                    w={260}
                    label="Signal (param, or instance.param)"
                    data={paramSuggestions}
                    defaultValue={sig}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim()
                      if (v && v !== sig && !(v in signals)) edit((d) => void (d.signals = renameKey(d.signals as Doc, sig, v)))
                    }}
                  />
                  <Button size="xs" variant="subtle" color="red" onClick={() => edit((d) => void delete (d.signals as Doc)[sig])}>
                    Remove signal
                  </Button>
                </Group>
                <SegmentList segs={Array.isArray(segs) ? (segs as Seg[]) : []} onChange={(next) => edit((d) => void ((d.signals as Doc)[sig] = next))} depth={0} />
              </Stack>
            </Card>
          ))}
          <Group>
            <Button
              size="xs"
              variant="light"
              onClick={() =>
                edit((d) => {
                  const s = isObj(d.signals) ? d.signals : (d.signals = {})
                  const name = paramSuggestions.find((p) => !(p in s)) ?? `signal_${Object.keys(s).length + 1}`
                  s[name] = [newSegment('hold') as Seg]
                })
              }
            >
              Add signal
            </Button>
          </Group>
          <FaultList faults={faults} onChange={(next) => edit((d) => void (next.length ? (d.faults = next) : delete d.faults))} />
        </Stack>
      )}

      <Card withBorder radius="md" padding="md" aria-label="Stimulus on the pod">
        <Group justify="space-between" wrap="wrap">
          <Stack gap={2}>
            <Text fw={600}>On the pod</Text>
            <Text size="xs" c="dimmed">
              Signals drive the running sensors' params; one stimulus is loaded at a time.
            </Text>
          </Stack>
          <Group gap="xs">
            <Tooltip label={runBlock} disabled={!runBlock}>
              <span>
                <Button size="xs" onClick={runOnPod} loading={busy === 'start'} disabled={!!runBlock}>
                  Start on the pod
                </Button>
              </span>
            </Tooltip>
            <Button size="xs" color="red" variant="light" onClick={stopOnPod} loading={busy === 'stop'} disabled={!pod || !stim?.running}>
              Stop
            </Button>
          </Group>
        </Group>
      </Card>
    </Stack>
  )
}

function SignalKey({ name, index }: { name: string; index: number }) {
  const colors = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#e03131', '#0c8599']
  return (
    <Group gap={4}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: colors[index % 6], display: 'inline-block' }} />
      <Text size="xs">{name}</Text>
    </Group>
  )
}

function renameKey(o: Doc, from: string, to: string): Doc {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]))
}

const shapeData = SEGMENT_SHAPES.map((s) => ({ value: s.shape, label: s.label }))

function pointsText(v: YamlValue | undefined): string {
  return Array.isArray(v) ? v.map((p) => (Array.isArray(p) ? p.join(', ') : '')).join('\n') : ''
}
function parsePoints(t: string): number[][] | null {
  const out: number[][] = []
  for (const line of t.split('\n')) {
    if (!line.trim()) continue
    const [a, b] = line.split(/[,;\s]+/).filter(Boolean).map(Number)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    out.push([a, b])
  }
  return out
}

/** A list of segments; repeat nests one (at most 4 deep). */
function SegmentList({ segs, onChange, depth }: { segs: Seg[]; onChange: (s: Seg[]) => void; depth: number }) {
  const set = (i: number, s: Seg) => onChange(segs.map((x, j) => (j === i ? s : x)))
  const move = (i: number, d: number) => {
    const next = [...segs]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    onChange(next)
  }
  return (
    <Stack gap={6} pl={depth ? 'md' : 0} style={depth ? { borderLeft: '2px solid var(--mantine-color-gray-4)' } : undefined}>
      {segs.map((seg, i) => {
        const shape = String(seg.shape ?? 'hold')
        const info = shapeInfo(shape)
        return (
          <Group key={i} gap="xs" align="flex-end" wrap="wrap" aria-label={`Segment ${i + 1}`}>
            <Text size="xs" c="dimmed" w={18} mb={8}>
              {i + 1}
            </Text>
            <Select
              size="xs"
              w={100}
              label="Shape"
              data={depth >= 3 ? shapeData.filter((s) => s.value !== 'repeat') : shapeData}
              value={shape}
              onChange={(v) => v && set(i, newSegment(v as SegmentShape) as Seg)}
              allowDeselect={false}
            />
            {info?.fields.map((f) =>
              f.type === 'interpolate' ? (
                <Select
                  key={f.key}
                  size="xs"
                  w={110}
                  label={f.label}
                  data={['linear', 'step']}
                  value={String(seg[f.key] ?? 'linear')}
                  onChange={(v) => v && set(i, { ...seg, [f.key]: v })}
                  allowDeselect={false}
                />
              ) : (
                <NumberInput
                  key={f.key}
                  size="xs"
                  w={f.key === 'duration_s' ? 110 : 96}
                  label={f.label}
                  placeholder={f.type === 'optional' ? 'previous' : undefined}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={typeof seg[f.key] === 'number' ? (seg[f.key] as number) : ''}
                  onChange={(v) => {
                    const next = { ...seg }
                    if (typeof v === 'number') next[f.key] = v
                    else if (f.type === 'optional') delete next[f.key]
                    set(i, next)
                  }}
                />
              ),
            )}
            <Group gap={2} mb={4}>
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Move down" disabled={i === segs.length - 1} onClick={() => move(i, 1)}>
                ↓
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove segment" onClick={() => onChange(segs.filter((_, j) => j !== i))}>
                ×
              </ActionIcon>
            </Group>
            {shape === 'data' && (
              <Textarea
                size="xs"
                w="100%"
                label="Points: seconds, value (one per line)"
                autosize
                minRows={2}
                maxRows={8}
                defaultValue={pointsText(seg.points)}
                onBlur={(e) => {
                  const p = parsePoints(e.currentTarget.value)
                  if (p) set(i, { ...seg, points: p })
                }}
                styles={{ input: { fontFamily: 'ui-monospace, Menlo, monospace' } }}
              />
            )}
            {shape === 'repeat' && (
              <div style={{ width: '100%' }}>
                <SegmentList segs={Array.isArray(seg.segments) ? (seg.segments as Seg[]) : []} onChange={(s) => set(i, { ...seg, segments: s })} depth={depth + 1} />
              </div>
            )}
          </Group>
        )
      })}
      <Group gap="xs">
        <Select
          size="xs"
          w={170}
          placeholder="Add a segment"
          aria-label="Add a segment"
          data={depth >= 3 ? shapeData.filter((s) => s.value !== 'repeat') : shapeData}
          value={null}
          onChange={(v) => v && onChange([...segs, newSegment(v as SegmentShape) as Seg])}
        />
      </Group>
    </Stack>
  )
}

const FAULT_COLS: { key: string; label: string; w: number; text?: boolean }[] = [
  { key: 'at_s', label: 'At (s)', w: 80 },
  { key: 'duration_s', label: 'For (s)', w: 80 },
  { key: 'sensor', label: 'Sensor', w: 100, text: true },
  { key: 'param', label: 'Param', w: 120, text: true },
  { key: 'value', label: 'Value', w: 80 },
  { key: 'at', label: 'Register', w: 80 },
  { key: 'mask', label: 'Mask', w: 70 },
  { key: 'rate_hz', label: 'Rate (Hz)', w: 80 },
]

function FaultList({ faults, onChange }: { faults: Seg[]; onChange: (f: Seg[]) => void }) {
  const set = (i: number, f: Seg) => onChange(faults.map((x, j) => (j === i ? f : x)))
  return (
    <Card withBorder radius="md" padding="sm" aria-label="Faults">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Faults
          </Text>
          <Button size="xs" variant="light" color="orange" onClick={() => onChange([...faults, { at_s: 0, duration_s: 1, type: 'stuck' }])}>
            Add fault
          </Button>
        </Group>
        {faults.length === 0 ? (
          <Text size="xs" c="dimmed">
            No faults. A fault switches on at its time, for its duration (empty: until the end).
          </Text>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table withTableBorder verticalSpacing={4} horizontalSpacing={6} miw={900}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Type</Table.Th>
                  {FAULT_COLS.map((c) => (
                    <Table.Th key={c.key}>{c.label}</Table.Th>
                  ))}
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {faults.map((f, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <Select
                        size="xs"
                        w={130}
                        aria-label="Fault type"
                        data={FAULT_TYPES.map((t) => ({ value: t.type, label: t.label }))}
                        value={String(f.type ?? 'stuck')}
                        onChange={(v) => v && set(i, { ...f, type: v })}
                        allowDeselect={false}
                      />
                    </Table.Td>
                    {FAULT_COLS.map((c) => (
                      <Table.Td key={c.key}>
                        {c.text ? (
                          <TextInput
                            size="xs"
                            w={c.w}
                            aria-label={c.label}
                            value={typeof f[c.key] === 'string' ? (f[c.key] as string) : ''}
                            onChange={(e) => {
                              const next = { ...f }
                              const v = e.currentTarget.value
                              if (v) next[c.key] = v
                              else delete next[c.key]
                              set(i, next)
                            }}
                          />
                        ) : (
                          <NumberInput
                            size="xs"
                            w={c.w}
                            aria-label={c.label}
                            value={typeof f[c.key] === 'number' ? (f[c.key] as number) : ''}
                            onChange={(v) => {
                              const next = { ...f }
                              if (typeof v === 'number') next[c.key] = v
                              else delete next[c.key]
                              set(i, next)
                            }}
                          />
                        )}
                      </Table.Td>
                    ))}
                    <Table.Td>
                      <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove fault" onClick={() => onChange(faults.filter((_, j) => j !== i))}>
                        ×
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </Card>
  )
}
