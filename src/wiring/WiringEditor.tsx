import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import {
  defaultDutDir,
  dutDirOverride,
  effectiveWiring,
  firstFreeLaChannel,
  laChannelMap,
  laPullLabel,
  LA_CHANNEL_COUNT,
  MAX_WIRING_SIGNALS,
  validateWiring,
  WIRING_DIRECTIONS,
  WIRING_DUT_DIR_LABELS,
  WIRING_DUT_DIRS,
  wiringFieldErrors,
  withDutDir,
  type Wiring,
  type WiringDirection,
  type WiringDutDir,
  type WiringRole,
} from './model'

// The wiring profile editor: which board signal is on which LA channel, the power rail, the UART
// baud, the SWD target. Host-neutral: it edits a profile object and hands it to onSave (the desktop
// app applies it with set_wiring and keeps it on the computer).

const NOT_WIRED = 'none'
const BAUDS = ['9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600', '1000000']
const DIRECTION_LABELS: Record<WiringDirection, string> = { input: 'input', output: 'output', open_drain: 'open-drain', bidir: 'bidirectional' }

function ChannelSelect({
  label,
  value,
  onChange,
  wiring,
  field,
  error,
}: {
  label: string
  value: number | null
  onChange: (la: number | null) => void
  wiring: Wiring
  field: string
  error?: string
}) {
  const map = useMemo(() => laChannelMap(wiring), [wiring])
  const data = useMemo(() => [{ value: NOT_WIRED, label: 'not wired' }, ...map.map((ch) => ({ value: String(ch.la), label: `LA${ch.la}` }))], [map])
  return (
    <Select
      size="xs"
      label={label}
      data={data}
      value={value == null ? NOT_WIRED : String(value)}
      onChange={(v) => v != null && onChange(v === NOT_WIRED ? null : Number(v))}
      allowDeselect={false}
      error={error}
      comboboxProps={{ width: 'max-content', position: 'bottom-start' }}
      renderOption={({ option }) => {
        if (option.value === NOT_WIRED) return <Text size="sm">not wired</Text>
        const ch = map[Number(option.value) - 1]
        const others = ch.users.filter((u) => u.field !== field)
        return (
          <Group gap={10} wrap="nowrap">
            <Text size="sm" ff="monospace" w={40}>
              {option.label}
            </Text>
            <Text size="xs" c="dimmed" w={84}>
              {laPullLabel(ch.pull)}
            </Text>
            <Text size="xs" c={others.length ? 'orange' : 'dimmed'}>
              {others.length ? `used by ${others.map((u) => u.label).join(', ')}` : 'free'}
            </Text>
          </Group>
        )
      }}
    />
  )
}

const DEFAULT_DIR = 'default'

/**
 * Which way each wired board signal goes: one row per wired role and signal, with its default and
 * an optional override (the profile's dut_dirs). The pod never drives a push-pull output on a
 * board output pin.
 */
export function WiringDirections({
  wiring,
  onChange,
  errors,
}: {
  wiring: Wiring
  onChange: (dutDirs: Record<string, WiringDutDir>) => void
  errors?: Map<string, string>
}) {
  const rows = useMemo(() => {
    const out: { name: string; label: string; la: number }[] = []
    for (const ch of laChannelMap(wiring))
      for (const u of ch.users) out.push({ name: u.kind === 'role' ? u.field : u.id, label: u.label, la: ch.la })
    return out
  }, [wiring])
  if (!rows.length) return <Text size="xs" c="dimmed">Nothing is wired.</Text>
  return (
    <Stack gap={4}>
      {rows.map((r) => {
        const def = defaultDutDir(wiring, r.name)
        const set = dutDirOverride(wiring, r.name)
        const key = Object.keys(wiring.dut_dirs ?? {}).find((k) => k.toLowerCase() === r.name.toLowerCase())
        return (
          <Group key={r.name} gap="xs" wrap="nowrap">
            <Text size="xs" ff="monospace" w={40}>
              LA{r.la}
            </Text>
            <Text size="xs" w={110} truncate>
              {r.label}
            </Text>
            <Select
              size="xs"
              w={210}
              aria-label={`${r.label} direction`}
              data={[
                { value: DEFAULT_DIR, label: `${WIRING_DUT_DIR_LABELS[def]} (default)` },
                ...WIRING_DUT_DIRS.filter((d) => d !== def).map((d) => ({ value: d, label: WIRING_DUT_DIR_LABELS[d] })),
              ]}
              value={set && set !== def ? set : DEFAULT_DIR}
              onChange={(v) => v && onChange(withDutDir(wiring, r.name, v === DEFAULT_DIR ? undefined : (v as WiringDutDir)))}
              allowDeselect={false}
              error={key ? errors?.get(`dut_dirs.${key}`) : undefined}
            />
          </Group>
        )
      })}
    </Stack>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={6}>
      <Divider label={title} labelPosition="left" />
      {children}
    </Stack>
  )
}

/** LA1..LA14 at a glance: the pull resistor and what the profile puts on each channel. */
export function WiringChannelMap({ wiring }: { wiring: Wiring }) {
  const map = useMemo(() => laChannelMap(wiring), [wiring])
  return (
    <SimpleGrid cols={{ base: 2, xs: 3 }} spacing={6} verticalSpacing={6}>
      {map.map((ch) => (
        <Paper key={ch.la} withBorder p={6} radius="sm" style={ch.conflict ? { borderColor: 'var(--mantine-color-red-6)' } : undefined}>
          <Group gap={6} justify="space-between" wrap="nowrap">
            <Text size="xs" fw={700} ff="monospace">
              LA{ch.la}
            </Text>
            <Text size="xs" c="dimmed">
              {laPullLabel(ch.pull)}
            </Text>
          </Group>
          <Text size="xs" c={ch.conflict ? 'red' : ch.users.length ? undefined : 'dimmed'} truncate>
            {ch.users.length ? ch.users.map((u) => u.label).join(' / ') : 'free'}
          </Text>
          {ch.dutDir ? (
            <Text size="xs" c="dimmed" truncate>
              {WIRING_DUT_DIR_LABELS[ch.dutDir]}
            </Text>
          ) : null}
          {ch.warnings.length ? (
            <Tooltip label={ch.warnings.join('; ')} multiline w={260}>
              <Badge size="xs" color="orange" variant="light">
                check
              </Badge>
            </Tooltip>
          ) : null}
        </Paper>
      ))}
    </SimpleGrid>
  )
}

function withDutDirRemoved(w: Wiring, name: string): Wiring {
  return { ...w, dut_dirs: withDutDir(w, name, undefined) }
}

export function WiringEditor({
  profile,
  source,
  onSave,
  saveLabel = 'Save wiring',
  note,
}: {
  /** The profile object as stored (the MCP server's wiring `profile`). Unknown keys are kept. */
  profile: Record<string, unknown>
  /** Where the profile came from, shown above the form. */
  source?: string
  /** Apply and keep the edited profile; resolve with an error message to show, or nothing. */
  onSave: (profile: Record<string, unknown>) => Promise<string | undefined>
  saveLabel?: string
  note?: ReactNode
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setDraft(profile)
  }, [profile])

  const w = useMemo(() => effectiveWiring(draft), [draft])
  const issues = useMemo(() => validateWiring(draft), [draft])
  const fieldErr = useMemo(() => wiringFieldErrors(w, issues.errors), [w, issues])
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile)
  const set = (patch: Record<string, unknown>) => {
    setSaved(false)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const role = (r: WiringRole, label: string) => (
    <ChannelSelect key={r} label={label} value={w[r]} onChange={(v) => set({ [r]: v })} wiring={w} field={r} error={fieldErr.get(r)} />
  )
  const signals = w.signals
  const setSignal = (i: number, patch: Partial<Wiring['signals'][number]>) => {
    const next: Record<string, unknown> = { signals: signals.map((s, k) => (k === i ? { ...s, ...patch } : s)) }
    // A renamed signal keeps its direction override.
    const old = signals[i].name
    const dir = old ? dutDirOverride(w, old) : undefined
    if (patch.name !== undefined && dir) next.dut_dirs = withDutDir(withDutDirRemoved(w, old), patch.name, dir)
    set(next)
  }
  const removeSignal = (i: number) =>
    set({ signals: signals.filter((_, k) => k !== i), dut_dirs: withDutDirRemoved(w, signals[i].name) })

  const save = async () => {
    setSaving(true)
    setError(undefined)
    try {
      // Explicit values for every key the editor shows, the rest as they were.
      const out: Record<string, unknown> = { ...draft, version: 1 }
      for (const k of ['la_mv', 'efuse', 'uart_rx', 'uart_tx', 'uart_baud', 'i2c_sda', 'i2c_scl', 'i2c_addr', 'swd_swclk', 'swd_swdio', 'swd_nreset', 'swd_target', 'spi_sclk', 'spi_mosi', 'spi_miso', 'spi_cs', 'signals', 'dut_dirs'] as const)
        out[k] = w[k]
      const e = await onSave(out)
      if (e) setError(e)
      else setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap="sm" p="sm">
      {source ? (
        <Text size="xs" c="dimmed">
          Profile from: {source}
        </Text>
      ) : null}
      {note}

      <Section title="Bench">
        <Group gap="md" align="flex-end">
          <Stack gap={2}>
            <Text size="xs" fw={500}>
              I/O voltage
            </Text>
            <SegmentedControl
              size="xs"
              data={[
                { value: '3300', label: '3.3 V' },
                { value: '1800', label: '1.8 V' },
              ]}
              value={String(w.la_mv)}
              onChange={(v) => set({ la_mv: Number(v) })}
            />
          </Stack>
          <Stack gap={2}>
            <Text size="xs" fw={500}>
              Target power
            </Text>
            <SegmentedControl
              size="xs"
              data={[
                { value: '1', label: 'Internal 5 V' },
                { value: '2', label: 'External' },
              ]}
              value={String(w.efuse)}
              onChange={(v) => set({ efuse: Number(v) })}
            />
          </Stack>
        </Group>
      </Section>

      <Section title="UART console">
        <Group gap="xs" align="flex-start">
          {role('uart_rx', 'RX (board TX)')}
          {role('uart_tx', 'TX (board RX)')}
          <Select
            size="xs"
            w={110}
            label="Baud"
            data={BAUDS.includes(String(w.uart_baud)) ? BAUDS : [...BAUDS, String(w.uart_baud)]}
            value={String(w.uart_baud)}
            onChange={(v) => v && set({ uart_baud: Number(v) })}
            searchable
            error={fieldErr.get('uart_baud')}
          />
        </Group>
      </Section>

      <Section title="I2C (sensor emulation)">
        <Group gap="xs" align="flex-start">
          {role('i2c_sda', 'SDA')}
          {role('i2c_scl', 'SCL')}
          <TextInput size="xs" w={90} label="Address" value={w.i2c_addr} onChange={(e) => set({ i2c_addr: e.currentTarget.value })} error={fieldErr.get('i2c_addr')} />
        </Group>
      </Section>

      <Section title="SWD (flashing)">
        <Group gap="xs" align="flex-start">
          {role('swd_swclk', 'SWCLK')}
          {role('swd_swdio', 'SWDIO')}
          <TextInput
            size="xs"
            style={{ flex: 1, minWidth: 180 }}
            label="OpenOCD target"
            placeholder="target/stm32f4x.cfg"
            value={w.swd_target}
            onChange={(e) => set({ swd_target: e.currentTarget.value })}
            error={fieldErr.get('swd_target')}
          />
        </Group>
        <Switch size="xs" label="The board's reset is wired to the pod's reset pin" checked={w.swd_nreset} onChange={(e) => set({ swd_nreset: e.currentTarget.checked })} />
      </Section>

      <Section title="SPI (flash chip, SPI master)">
        <Group gap="xs" align="flex-start">
          {role('spi_sclk', 'SCLK')}
          {role('spi_mosi', 'MOSI')}
          {role('spi_miso', 'MISO')}
          {role('spi_cs', 'CS')}
        </Group>
      </Section>

      <Section title="Named signals">
        {signals.map((s, i) => (
          <Group key={i} gap="xs" align="flex-start" wrap="wrap">
            <TextInput size="xs" w={110} placeholder="NAME" aria-label="Signal name" value={s.name} onChange={(e) => setSignal(i, { name: e.currentTarget.value })} error={fieldErr.get(`signals[${i}].name`)} />
            <Select
              size="xs"
              w={76}
              aria-label="Signal channel"
              data={Array.from({ length: LA_CHANNEL_COUNT }, (_, k) => ({ value: String(k + 1), label: `LA${k + 1}` }))}
              value={String(s.la)}
              onChange={(v) => v && setSignal(i, { la: Number(v) })}
              allowDeselect={false}
              error={fieldErr.get(`signals[${i}].la`)}
            />
            <Select
              size="xs"
              w={120}
              aria-label="Signal direction"
              data={WIRING_DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABELS[d] }))}
              value={s.direction}
              onChange={(v) => v && setSignal(i, { direction: v as WiringDirection })}
              allowDeselect={false}
            />
            <Checkbox size="xs" mt={6} label="active low" checked={s.active_low} onChange={(e) => setSignal(i, { active_low: e.currentTarget.checked })} />
            <TextInput size="xs" style={{ flex: 1, minWidth: 140 }} placeholder="what it is" aria-label="Signal description" value={s.description} onChange={(e) => setSignal(i, { description: e.currentTarget.value })} />
            <ActionIcon size="sm" mt={4} variant="subtle" color="gray" aria-label={`Remove ${s.name || 'signal'}`} onClick={() => removeSignal(i)}>
              ✕
            </ActionIcon>
          </Group>
        ))}
        <Group>
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={signals.length >= MAX_WIRING_SIGNALS || firstFreeLaChannel(w) == null}
            onClick={() => set({ signals: [...signals, { name: '', la: firstFreeLaChannel(w) ?? 1, direction: 'input', active_low: false, description: '' }] })}
          >
            + Add a signal
          </Button>
        </Group>
      </Section>

      <Section title="Pin directions">
        <Text size="xs" c="dimmed">
          Which way each board signal goes. The pod never drives a board output with a push-pull driver, so it can't fight the board. Each
          role and signal has a default; change it only when your board differs. Sent to the pod whenever the wiring is applied.
        </Text>
        <WiringDirections wiring={w} onChange={(d) => set({ dut_dirs: d })} errors={fieldErr} />
      </Section>

      <Section title="Channels">
        <WiringChannelMap wiring={w} />
      </Section>

      {issues.warnings.length ? (
        <Alert color="orange" variant="light" p="xs">
          {issues.warnings.map((x) => (
            <Text key={x.field + x.message} size="xs">
              {x.field}: {x.message}
            </Text>
          ))}
        </Alert>
      ) : null}
      {issues.errors.length ? (
        <Text size="xs" c="red">
          Fix {issues.errors.length === 1 ? 'the highlighted field' : `the ${issues.errors.length} highlighted fields`} to save.
        </Text>
      ) : null}
      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}
      <Group gap="xs">
        <Button size="xs" onClick={() => void save()} loading={saving} disabled={!dirty || issues.errors.length > 0}>
          {saveLabel}
        </Button>
        <Button size="xs" variant="default" onClick={() => setDraft(profile)} disabled={!dirty || saving}>
          Undo changes
        </Button>
        {saved && !dirty ? (
          <Text size="xs" c="teal">
            Saved
          </Text>
        ) : null}
      </Group>
    </Stack>
  )
}
