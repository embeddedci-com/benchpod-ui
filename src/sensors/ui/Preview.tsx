import { useMemo, useState } from 'react'
import { Badge, Box, Button, Code, Group, NumberInput, Select, SimpleGrid, Slider, Stack, Text, TextInput, Tooltip, useComputedColorScheme } from '@mantine/core'
import type { AnalogPreview, Engine, ParamInfo, ValidateOk } from '../engine'
import { LineChart } from './LineChart'

/** A slider step for a param range: about a thousand steps, rounded to 1, 2 or 5. */
export function paramStep(p: ParamInfo): number {
  const span = p.max - p.min
  if (!(span > 0)) return 1
  const raw = span / 1000
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

const roundTo = (v: number, step: number) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)))
  return Number(v.toFixed(Math.min(d, 10)))
}

export const defaultValues = (params: ParamInfo[]) => Object.fromEntries(params.map((p) => [p.key, p.default]))

export const paramLabel = (p: ParamInfo) => `${p.label || p.key}${p.unit ? ` (${p.unit})` : ''}`

/** One slider and a number box per param. */
export function ParamSliders({
  params,
  values,
  onChange,
  disabled,
}: {
  params: ParamInfo[]
  values: Record<string, number>
  onChange: (key: string, value: number) => void
  disabled?: boolean
}) {
  if (params.length === 0) return <Text size="sm" c="dimmed">This sensor has no params.</Text>
  return (
    <SimpleGrid cols={{ base: 1, sm: params.length > 1 ? 2 : 1 }} spacing="md" verticalSpacing="xs">
      {params.map((p) => {
        const step = paramStep(p)
        const v = values[p.key] ?? p.default
        return (
          <Box key={p.key}>
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text size="sm" fw={500} truncate>
                {paramLabel(p)}
              </Text>
              <NumberInput
                size="xs"
                w={110}
                aria-label={paramLabel(p)}
                value={v}
                min={p.min}
                max={p.max}
                step={step}
                clampBehavior="blur"
                disabled={disabled}
                onChange={(x) => typeof x === 'number' && x >= p.min && x <= p.max && onChange(p.key, x)}
              />
            </Group>
            <Slider
              mt={4}
              aria-label={`${paramLabel(p)} slider`}
              min={p.min}
              max={p.max}
              step={step}
              value={v}
              disabled={disabled}
              label={(x) => roundTo(x, step)}
              onChange={(x) => onChange(p.key, roundTo(x, step))}
            />
          </Box>
        )
      })}
    </SimpleGrid>
  )
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')

/** The 256-byte register image, 16 per row: rebuilt registers highlighted, read-only ones marked. */
export function RegisterGrid({
  image,
  dynamic = [],
  readOnly = [],
  changed = [],
  title = 'Register image',
}: {
  image: Uint8Array
  dynamic?: number[]
  readOnly?: number[]
  changed?: number[]
  title?: string
}) {
  const dark = useComputedColorScheme('light') === 'dark'
  const dyn = new Set(dynamic)
  const ro = new Set(readOnly)
  const ch = new Set(changed)
  const rows = Math.ceil(image.length / 16)
  const font = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Group gap={6}>
          <Badge size="xs" variant="light" color="orange">
            rebuilt
          </Badge>
          <Badge size="xs" variant="outline" color="gray">
            read-only
          </Badge>
        </Group>
      </Group>
      <Box style={{ overflowX: 'auto' }}>
        <table aria-label={title} style={{ borderCollapse: 'collapse', fontFamily: font, fontSize: 12 }}>
          <thead>
            <tr>
              <th />
              {Array.from({ length: 16 }, (_, c) => (
                <th key={c} style={{ padding: '0 4px', color: dark ? '#8892a4' : '#94a3b8', fontWeight: 400 }}>
                  {c.toString(16).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                <td style={{ paddingRight: 6, color: dark ? '#8892a4' : '#94a3b8' }}>{hex2(r * 16)}</td>
                {Array.from({ length: 16 }, (_, c) => {
                  const a = r * 16 + c
                  if (a >= image.length) return <td key={c} />
                  const isDyn = dyn.has(a)
                  return (
                    <td
                      key={c}
                      title={`0x${hex2(a)} = 0x${hex2(image[a])} (${image[a]})${isDyn ? ', rebuilt' : ''}${ro.has(a) ? ', read-only' : ''}`}
                      data-reg={hex2(a)}
                      data-dynamic={isDyn || undefined}
                      style={{
                        padding: '1px 4px',
                        textAlign: 'center',
                        borderRadius: 2,
                        background: isDyn ? (dark ? 'rgba(245, 158, 11, 0.25)' : 'rgba(232, 89, 12, 0.14)') : undefined,
                        outline: ro.has(a) ? `1px solid ${dark ? '#5c6578' : '#adb5bd'}` : undefined,
                        fontWeight: ch.has(a) ? 700 : 400,
                        color: image[a] === 0 && !isDyn ? (dark ? '#5c5f66' : '#ced4da') : undefined,
                      }}
                    >
                      {hex2(image[a])}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Stack>
  )
}

/** Text with control characters shown as escapes (\r, \n, \x00). */
export function visibleText(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]/g, (c) => (c === '\r' ? '\\r' : c === '\n' ? '\\n\n' : c === '\t' ? '\\t' : `\\x${hex2(c.charCodeAt(0))}`))
}

/** What a sensor puts out for the current values: the register image, UART text or analog output. */
export function DefinitionPreview({
  engine,
  json,
  info,
  values,
}: {
  engine: Engine
  json: string
  info: ValidateOk
  values: Record<string, number>
}) {
  const [tMs, setTMs] = useState(0)
  const preview = useMemo(() => engine.preview(json, values, { tMs }), [engine, json, values, tMs])
  if (!preview.ok) {
    return (
      <Text size="sm" c="red">
        {preview.error}
      </Text>
    )
  }
  if (preview.kind === 'i2c' || preview.kind === 'spi') {
    return (
      <Stack gap="xs">
        <TimeInput tMs={tMs} onChange={setTMs} />
        <RegisterGrid image={preview.image} dynamic={preview.dynamic} readOnly={preview.read_only} changed={preview.changed} />
      </Stack>
    )
  }
  if (preview.kind === 'uart') return <UartPreviewView engine={engine} json={json} values={values} preview={preview} tMs={tMs} setTMs={setTMs} />
  const analog = preview as AnalogPreview
  return <AnalogPreviewView engine={engine} json={json} info={info} values={values} value={analog.value} unit={analog.unit} />
}

function TimeInput({ tMs, onChange }: { tMs: number; onChange: (t: number) => void }) {
  return (
    <Group gap="xs" align="flex-end">
      <NumberInput
        size="xs"
        w={150}
        label="Time since start (s)"
        min={0}
        step={1}
        decimalScale={3}
        value={tMs / 1000}
        onChange={(v) => typeof v === 'number' && v >= 0 && onChange(Math.round(v * 1000))}
      />
      <Text size="xs" c="dimmed" pb={6}>
        State and time-based values advance to this time.
      </Text>
    </Group>
  )
}

function UartPreviewView({
  engine,
  json,
  values,
  preview,
  tMs,
  setTMs,
}: {
  engine: Engine
  json: string
  values: Record<string, number>
  preview: { at_ms: number | null; text: string; next_ms: number | null; epochs: number }
  tMs: number
  setTMs: (t: number) => void
}) {
  const [request, setRequest] = useState('')
  const answer = useMemo(() => {
    if (!request) return null
    const req = request.replace(/\\r/g, '\r').replace(/\\n/g, '\n')
    return engine.uartAnswer(json, values, req.endsWith('\n') || req.endsWith('\r') ? req : req + '\r\n', { tMs })
  }, [engine, json, values, request, tMs])
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end">
        <Text size="sm" fw={600}>
          {preview.at_ms === null ? 'Nothing sent yet' : `Sent at ${(preview.at_ms / 1000).toFixed(3)} s`}
        </Text>
        <Tooltip label="Advance to the next time the sensor sends" disabled={preview.next_ms === null}>
          <Button size="xs" variant="light" disabled={preview.next_ms === null} onClick={() => preview.next_ms !== null && setTMs(preview.next_ms)}>
            Next message
          </Button>
        </Tooltip>
      </Group>
      <Code block aria-label="UART output" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', minHeight: 60 }}>
        {visibleText(preview.text) || ' '}
      </Code>
      <TextInput
        size="xs"
        label="Try a request"
        description="What the DUT sends; a line end is added. \r and \n work."
        placeholder="READ?"
        value={request}
        onChange={(e) => setRequest(e.currentTarget.value)}
      />
      {answer &&
        (answer.ok ? (
          answer.answers.length ? (
            <Code block aria-label="UART answer" style={{ whiteSpace: 'pre-wrap' }}>
              {answer.answers.map((a) => visibleText(a.text)).join('\n')}
            </Code>
          ) : (
            <Text size="xs" c="dimmed">
              No request matches.
            </Text>
          )
        ) : (
          <Text size="xs" c="red">
            {answer.error}
          </Text>
        ))}
    </Stack>
  )
}

function AnalogPreviewView({
  engine,
  json,
  info,
  values,
  value,
  unit,
}: {
  engine: Engine
  json: string
  info: ValidateOk
  values: Record<string, number>
  value: number | null
  unit: string
}) {
  const [axis, setAxis] = useState(info.params[0]?.key ?? '')
  const p = info.params.find((x) => x.key === axis) ?? info.params[0]
  const curve = useMemo(() => {
    if (!p) return null
    const N = 81
    const x: number[] = []
    const y: (number | null)[] = []
    for (let i = 0; i < N; i++) {
      const v = p.min + ((p.max - p.min) * i) / (N - 1)
      const r = engine.preview(json, { ...values, [p.key]: v })
      x.push(v)
      y.push(r.ok && r.kind === 'analog' ? r.value : null)
    }
    return { x, y }
  }, [engine, json, values, p])
  return (
    <Stack gap="xs">
      <Group gap="md" align="baseline">
        <Text size="sm" c="dimmed">
          Output
        </Text>
        <Text size="xl" fw={700} aria-label="Analog output">
          {value === null ? 'none' : `${Number(value.toPrecision(5))} ${unit}`}
        </Text>
      </Group>
      {p && curve && (
        <>
          {info.params.length > 1 && (
            <Select
              size="xs"
              w={240}
              label="Transfer curve over"
              data={info.params.map((x) => ({ value: x.key, label: paramLabel(x) }))}
              value={p.key}
              onChange={(v) => v && setAxis(v)}
              allowDeselect={false}
            />
          )}
          <LineChart
            ariaLabel="Transfer curve"
            x={curve.x}
            series={[{ name: unit, y: curve.y, unit }]}
            marker={value === null ? null : { x: values[p.key] ?? p.default, y: value }}
            xUnit={p.unit ?? ''}
            height={180}
          />
          <Text size="xs" c="dimmed">
            {unit} against {paramLabel(p)}, the other params as set.
          </Text>
        </>
      )}
    </Stack>
  )
}
