import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Code, Group, NumberInput, Progress, Select, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import type { ParamInfo, SensorKind, ValidateOk } from '../engine'
import { FAULT_TYPES, KIND_PINS, faultTypesFor, type FaultField } from '../model'
import type { FaultSpec, InstanceStatus, SensorPins, SensorPod } from '../pod'
import { ParamSliders, defaultValues, paramLabel } from './Preview'

export const LA_CHANNELS = 14

/** What the host knows about the bench, for the pin pickers and the steps around a start. */
export type BenchHooks = {
  /** Pins from the bench's wiring profile for a kind (`{sda: 2, scl: 1}`), as start values. */
  pinDefaults?: (kind: SensorKind) => SensorPins
  /** "LA1 · I2C SDA": a channel with what the wiring puts on it. */
  channelLabel?: (la: number) => string
  /** Runs before sensor_start, e.g. pull-ups on I2C lines. Throw to stop the start. */
  prepareStart?: (kind: SensorKind, pins: SensorPins) => Promise<void>
}

/** Why the pod cannot run sensors now, or null. */
export type RunBlock = string | null

const isName = (s: string) => /^[a-z0-9_]{1,32}$/.test(s)
const hexAddr = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`

/** Start a definition on the pod: instance name, pins, address or baud; then its live card. */
export function RunPanel({
  pod,
  block,
  info,
  json,
  defaultInstance,
  running,
  bench,
  onChanged,
}: {
  pod: SensorPod | null
  block: RunBlock
  info: ValidateOk
  json: string
  defaultInstance: string
  running: InstanceStatus | null
  bench: BenchHooks
  onChanged: () => void
}) {
  const kind = info.kind
  const [instance, setInstance] = useState(defaultInstance)
  const [pins, setPins] = useState<Record<string, string>>(() => pinStrings(bench.pinDefaults?.(kind) ?? {}, kind))
  const addresses = useMemo(() => {
    const a = typeof info.bus?.address === 'number' ? [info.bus.address] : []
    return [...a, ...((info.bus?.alt as number[] | undefined) ?? [])].map(hexAddr)
  }, [info])
  const [address, setAddress] = useState<string | null>(addresses[0] ?? null)
  const [baud, setBaud] = useState<number | ''>(info.uart?.baud ?? '')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => setInstance(defaultInstance), [defaultInstance])
  useEffect(() => setAddress((a) => (a && addresses.includes(a) ? a : (addresses[0] ?? null))), [addresses])

  const channelData = Array.from({ length: LA_CHANNELS }, (_, i) => ({ value: String(i + 1), label: bench.channelLabel?.(i + 1) ?? `LA${i + 1}` }))
  const pinDefs = KIND_PINS[kind]
  const missing = pinDefs.filter((p) => p.required && !pins[p.key]).map((p) => p.label)
  const chosen = pinDefs.map((p) => pins[p.key]).filter(Boolean)
  const dup = chosen.length !== new Set(chosen).size
  const why =
    block ??
    (!pod ? 'No pod' : !isName(instance) ? 'Instance name: a-z, 0-9 and _, up to 32' : missing.length ? `Pick ${missing.join(', ')}` : dup ? 'Two pins on one channel' : null)

  const start = async () => {
    if (!pod || why) return
    setBusy(true)
    setError(null)
    setNote(null)
    setProgress(0)
    try {
      const p: SensorPins = {}
      for (const d of pinDefs) if (pins[d.key]) p[d.key] = Number(pins[d.key])
      if (kind === 'analog') p.output = pins.output || (info.analog?.output === 'current' ? 'current' : 'dac')
      await bench.prepareStart?.(kind, p)
      await pod.define(instance, json, { onProgress: (s, t) => setProgress(t ? (100 * s) / t : 100) })
      const r = await pod.start(instance, {
        pins: p,
        ...(kind === 'i2c' && address ? { address } : {}),
        ...(kind === 'uart' && baud && baud !== info.uart?.baud ? { baud: Number(baud) } : {}),
      })
      if (r.image_loaded) {
        setNote(`The pod loaded its emulation image.${r.unavailable?.length ? ` Not available while it runs: ${r.unavailable.join(', ')}.` : ''}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
      onChanged()
    }
  }

  if (running) {
    return (
      <Stack gap="sm">
        {note && (
          <Alert color="blue" variant="light">
            {note}
          </Alert>
        )}
        <InstanceCard pod={pod} inst={running} params={info.params} block={block} onChanged={onChanged} />
      </Stack>
    )
  }

  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <TextInput label="Instance" value={instance} onChange={(e) => setInstance(e.currentTarget.value)} error={instance && !isName(instance) ? 'a-z, 0-9, _' : undefined} />
        {pinDefs.map((d) => (
          <Select
            key={d.key}
            label={d.label}
            placeholder={d.required ? 'Pick a channel' : 'None'}
            data={channelData}
            value={pins[d.key] || null}
            onChange={(v) => setPins((x) => ({ ...x, [d.key]: v ?? '' }))}
            clearable={!d.required}
            searchable
          />
        ))}
        {kind === 'analog' && (
          <Select
            label="Output"
            data={[
              { value: 'dac', label: 'DAC (voltage)' },
              { value: 'current', label: '4-20 mA (current)' },
            ]}
            value={pins.output || (info.analog?.output === 'current' ? 'current' : 'dac')}
            onChange={(v) => setPins((x) => ({ ...x, output: v ?? 'dac' }))}
            allowDeselect={false}
          />
        )}
        {kind === 'i2c' && addresses.length > 0 && (
          <Select label="Address" data={addresses} value={address} onChange={setAddress} allowDeselect={false} />
        )}
        {kind === 'uart' && <NumberInput label="Baud" value={baud} min={300} max={3000000} onChange={(v) => setBaud(typeof v === 'number' ? v : '')} />}
      </SimpleGrid>
      {kind === 'i2c' && (
        <Text size="xs" c="dimmed">
          I2C needs pull-ups on SDA and SCL: put them on LA1-LA6.
        </Text>
      )}
      {progress !== null && <Progress value={progress} size="sm" aria-label="Upload" />}
      {error && (
        <Alert color="red" variant="light" title="The pod refused">
          {error}
        </Alert>
      )}
      <Group justify="flex-end">
        <Tooltip label={why} disabled={!why}>
          <span>
            <Button onClick={start} loading={busy} disabled={!!why}>
              Start on the pod
            </Button>
          </span>
        </Tooltip>
      </Group>
    </Stack>
  )
}

function pinStrings(p: SensorPins, kind: SensorKind): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of KIND_PINS[kind]) if (p[d.key] !== undefined && p[d.key] !== null) out[d.key] = String(p[d.key])
  if (p.output) out.output = String(p.output)
  return out
}

function busText(bus: Record<string, unknown> | undefined): string[] {
  if (!bus) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(bus)) {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (k === 'last_write' && 'at' in o) out.push(`last write ${o.at} = ${o.value}`)
      else out.push(`${k.replace(/_/g, ' ')} ${JSON.stringify(v)}`)
    } else out.push(`${k.replace(/_/g, ' ')} ${v}`)
  }
  return out
}

/** A running instance: live counters, readings, faults, register read-back, stop. */
export function InstanceCard({
  pod,
  inst,
  params,
  block,
  onChanged,
}: {
  pod: SensorPod | null
  inst: InstanceStatus
  params?: ParamInfo[]
  block: RunBlock
  onChanged: () => void
}) {
  // Without the definition (an instance another client started) the params are the status
  // values without a range: number boxes instead of sliders.
  const known = params ?? []
  const [values, setValues] = useState<Record<string, number>>(() => ({ ...defaultValues(known), ...(inst.values ?? {}) }))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const pending = useRef<Record<string, number>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  // Slider moves are sent at most every 150 ms, the latest value of each param.
  const setValue = (key: string, v: number) => {
    setValues((x) => ({ ...x, [key]: v }))
    pending.current[key] = v
    if (timer.current) return
    timer.current = setTimeout(async () => {
      timer.current = null
      const send = pending.current
      pending.current = {}
      try {
        await pod?.set(inst.instance, send)
      } catch (e) {
        setError((e as Error).message)
      }
    }, 150)
  }

  const unknownKeys = Object.keys(inst.values ?? {}).filter((k) => !known.some((p) => p.key === k))
  const lines = busText(inst.bus)
  return (
    <Card withBorder radius="md" padding="md" aria-label={`Instance ${inst.instance}`}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Text fw={600}>{inst.instance}</Text>
            <Badge variant="light">{inst.name}</Badge>
            <Badge variant="light" color={inst.running ? 'green' : 'gray'}>
              {inst.running ? 'running' : 'stopped'}
            </Badge>
            {inst.address && <Badge variant="outline">{inst.address}</Badge>}
            {inst.pins && (
              <Text size="xs" c="dimmed">
                {Object.entries(inst.pins)
                  .map(([k, v]) => `${k} ${typeof v === 'number' ? `LA${v}` : v}`)
                  .join(', ')}
              </Text>
            )}
          </Group>
          <Button color="red" variant="light" size="xs" loading={busy === 'stop'} disabled={!pod} onClick={() => act('stop', () => pod!.stop(inst.instance))}>
            Stop
          </Button>
        </Group>
        <Text size="xs" c="dimmed" aria-label="Bus counters">
          {lines.length ? lines.join(' · ') : 'No bus activity yet.'}
        </Text>
        {known.length > 0 && <ParamSliders params={known} values={values} onChange={setValue} disabled={!!block} />}
        {unknownKeys.length > 0 && (
          <Group gap="sm">
            {unknownKeys.map((k) => (
              <NumberInput key={k} size="xs" w={140} label={k} value={values[k] ?? 0} onChange={(v) => typeof v === 'number' && setValue(k, v)} />
            ))}
          </Group>
        )}
        <FaultControls pod={pod} inst={inst} params={known.length ? known : unknownKeys.map((k) => ({ key: k, min: 0, max: 0, default: 0 }))} busy={busy} act={act} block={block} />
        {(inst.kind === 'i2c' || inst.kind === 'spi') && <RegsReadback pod={pod} instance={inst.instance} block={block} />}
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
      </Stack>
    </Card>
  )
}

function FaultControls({
  pod,
  inst,
  params,
  busy,
  act,
  block,
}: {
  pod: SensorPod | null
  inst: InstanceStatus
  params: ParamInfo[]
  busy: string | null
  act: (what: string, fn: () => Promise<unknown>) => Promise<void>
  block: RunBlock
}) {
  const types = faultTypesFor(inst.kind)
  const [type, setType] = useState(types[0]?.type ?? 'stuck')
  const ft = FAULT_TYPES.find((f) => f.type === type)
  const [f, setF] = useState<Record<FaultField | 'duration_s', string>>({ param: '', value: '', at: '', mask: '', rate_hz: '', duration_s: '' })
  const fields = [...(ft?.needs ?? []), ...(ft?.takes ?? [])]
  const missing = (ft?.needs ?? []).filter((k) => !f[k])
  const spec = (): FaultSpec => {
    const num = (s: string) => (s === '' ? undefined : Number(s))
    const hexOrNum = (s: string) => (s === '' ? undefined : /^0x/i.test(s) ? parseInt(s, 16) : Number(s))
    return {
      type,
      ...(f.duration_s !== '' ? { duration_s: Number(f.duration_s) } : {}),
      ...(fields.includes('param') && f.param ? { param: f.param } : {}),
      ...(fields.includes('value') && f.value !== '' ? { value: num(f.value) } : {}),
      ...(fields.includes('at') ? { at: hexOrNum(f.at) } : {}),
      ...(fields.includes('mask') ? { mask: hexOrNum(f.mask) } : {}),
      ...(fields.includes('rate_hz') && f.rate_hz !== '' ? { rate_hz: num(f.rate_hz) } : {}),
    }
  }
  const set = (k: FaultField | 'duration_s') => (v: unknown) => setF((x) => ({ ...x, [k]: v === null || v === undefined ? '' : String(v) }))
  return (
    <Stack gap={6}>
      <Group gap="xs">
        <Text size="sm" fw={600}>
          Faults
        </Text>
        {(inst.faults ?? []).length === 0 ? (
          <Text size="xs" c="dimmed">
            none active
          </Text>
        ) : (
          (inst.faults ?? []).map((x, i) => (
            <Badge key={i} color="red" variant="light">
              {x.type}
            </Badge>
          ))
        )}
      </Group>
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select
          size="xs"
          w={150}
          label="Type"
          data={types.map((t) => ({ value: t.type, label: t.label }))}
          value={type}
          onChange={(v) => v && setType(v)}
          allowDeselect={false}
        />
        {fields.includes('param') && (
          <Select size="xs" w={160} label="Param" data={params.map((p) => ({ value: p.key, label: paramLabel(p) }))} value={f.param || null} onChange={set('param')} clearable={!ft?.needs.includes('param')} />
        )}
        {fields.includes('value') && <NumberInput size="xs" w={100} label="Value" value={f.value} onChange={set('value')} />}
        {fields.includes('at') && <TextInput size="xs" w={90} label="Register" placeholder="0xF7" value={f.at} onChange={(e) => set('at')(e.currentTarget.value)} />}
        {fields.includes('mask') && <TextInput size="xs" w={80} label="Mask" placeholder="0x01" value={f.mask} onChange={(e) => set('mask')(e.currentTarget.value)} />}
        {fields.includes('rate_hz') && <NumberInput size="xs" w={100} label="Rate (Hz)" placeholder="100" value={f.rate_hz} onChange={set('rate_hz')} />}
        <NumberInput size="xs" w={120} label="Duration (s)" placeholder="until cleared" min={0} value={f.duration_s} onChange={set('duration_s')} />
        <Tooltip label={missing.length ? `Set ${missing.join(', ')}` : ft?.help} disabled={!ft}>
          <span>
            <Button size="xs" variant="light" color="orange" disabled={!pod || !!block || missing.length > 0} loading={busy === 'fault'} onClick={() => act('fault', () => pod!.fault(inst.instance, spec()))}>
              Inject
            </Button>
          </span>
        </Tooltip>
        <Button size="xs" variant="subtle" color="gray" disabled={!pod || !!block} loading={busy === 'clear'} onClick={() => act('clear', () => pod!.faultClear(inst.instance))}>
          Clear faults
        </Button>
      </Group>
    </Stack>
  )
}

function RegsReadback({ pod, instance, block }: { pod: SensorPod | null; instance: string; block: RunBlock }) {
  const [start, setStart] = useState('0x00')
  const [len, setLen] = useState<number | ''>(16)
  const [bytes, setBytes] = useState<{ start: number; b: Uint8Array } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const s = /^0x[0-9a-f]+$/i.test(start) ? parseInt(start, 16) : Number(start)
  const ok = Number.isInteger(s) && s >= 0 && s <= 255 && typeof len === 'number' && len >= 1 && len <= 256
  const read = async () => {
    if (!pod || !ok) return
    setBusy(true)
    setError(null)
    try {
      setBytes({ start: s, b: await pod.regs(instance, s, Number(len)) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const rows: string[] = []
  if (bytes) {
    for (let i = 0; i < bytes.b.length; i += 16) {
      const a = (bytes.start + i) & 0xff
      rows.push(
        `${a.toString(16).toUpperCase().padStart(2, '0')}: ${[...bytes.b.slice(i, i + 16)].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`,
      )
    }
  }
  return (
    <Stack gap={6}>
      <Group gap="xs" align="flex-end">
        <Text size="sm" fw={600} mb={6}>
          Registers on the pod
        </Text>
        <TextInput size="xs" w={80} label="From" value={start} onChange={(e) => setStart(e.currentTarget.value)} error={!ok && start ? ' ' : undefined} />
        <NumberInput size="xs" w={80} label="Bytes" min={1} max={256} value={len} onChange={(v) => setLen(typeof v === 'number' ? v : '')} />
        <Button size="xs" variant="light" disabled={!pod || !ok || !!block} loading={busy} onClick={read}>
          Read
        </Button>
      </Group>
      {bytes && (
        <Code block aria-label="Register read-back">
          {rows.join('\n') || 'No bytes.'}
        </Code>
      )}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  )
}
