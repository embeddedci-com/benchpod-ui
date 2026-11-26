import { useEffect, useState } from 'react'
import { ActionIcon, Anchor, Button, Collapse, Group, Paper, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { HelpTip } from '../help/HelpTip'
import {
  INA260_SHUNT_OHM,
  MAX_WIRING_MONITORS,
  MONITOR_AVERAGING,
  MONITOR_CHIPS,
  monitorDefaultName,
  type MonitorChip,
  type Wiring,
  type WiringMonitor,
} from './model'

// The wiring profile's `monitors`: external INA current-monitor breakouts the SDK attaches on connect.
// One small card per monitor; the rare settings sit under "Advanced". Controlled: reports the new
// list as a patch of the profile (empty = `undefined`, so the key is left out when it is saved).

const DOCS = '/docs/benchpod-targets/gpio-expanders#monitors-profile'
const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

/** The first address a new monitor can take (64..79, or 64..67 for the ina3221) that no other uses. */
function freeAddr(list: WiringMonitor[], chip: MonitorChip): number {
  const max = chip === 'ina3221' ? 0x43 : 0x4f
  for (let a = 0x40; a <= max; a += 1) if (!list.some((m) => m.addr === a)) return a
  return 0x40
}

/** "0x40", "64" or "0x4" as a number, null when it is not one. */
export function parseAddr(text: string): number | null {
  const t = text.trim()
  if (/^0x[0-9a-f]{1,2}$/i.test(t)) return Number.parseInt(t.slice(2), 16)
  if (/^\d{1,3}$/.test(t)) return Number.parseInt(t, 10)
  return null
}

/** A text input for an optional number: keeps what is typed, reports a number or undefined (empty). */
function NumberField({
  label,
  value,
  onValue,
  placeholder,
  error,
  disabled,
  integer,
}: {
  label: string
  value: number | undefined
  onValue: (v: number | undefined) => void
  placeholder?: string
  error?: string
  disabled?: boolean
  integer?: boolean
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [typo, setTypo] = useState(false)
  useEffect(() => {
    // A change from outside (another row, undo) replaces what is typed; typing itself does not.
    setText((t) => (t.trim() === '' ? (value === undefined ? t : String(value)) : Number(t) === value ? t : value === undefined ? '' : String(value)))
  }, [value])
  return (
    <TextInput
      size="xs"
      label={label}
      placeholder={placeholder}
      value={text}
      inputMode="decimal"
      disabled={disabled}
      error={error ?? (typo ? `${label} must be a number` : undefined)}
      onChange={(e) => {
        const t = e.currentTarget.value
        setText(t)
        if (t.trim() === '') {
          setTypo(false)
          onValue(undefined)
          return
        }
        const n = Number(t)
        if (Number.isFinite(n) && (!integer || Number.isInteger(n))) {
          setTypo(false)
          onValue(n)
        } else setTypo(true)
      }}
    />
  )
}

function AddrField({ value, onValue, error, disabled }: { value: number; onValue: (v: number) => void; error?: string; disabled?: boolean }) {
  const [text, setText] = useState(hex(value))
  useEffect(() => {
    setText((t) => (parseAddr(t) === value ? t : hex(value)))
  }, [value])
  const parsed = parseAddr(text)
  return (
    <TextInput
      size="xs"
      label="Address"
      placeholder="0x40"
      value={text}
      disabled={disabled}
      error={error ?? (parsed === null ? 'Address is hex, like 0x40' : undefined)}
      onChange={(e) => {
        const t = e.currentTarget.value
        setText(t)
        const n = parseAddr(t)
        // An unparsable text keeps its error; the profile gets 0, which is out of range and flagged too.
        onValue(n ?? 0)
      }}
    />
  )
}

function MonitorCard({
  m,
  index,
  wiring,
  update,
  remove,
  errors,
  disabled,
}: {
  m: WiringMonitor
  index: number
  wiring: Wiring
  update: (patch: Partial<WiringMonitor> & Record<string, unknown>) => void
  remove: () => void
  errors?: Map<string, string>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const p = `monitors[${index}]`
  const err = (k: string) => errors?.get(`${p}.${k}`)
  const advancedError = ['sda', 'scl', 'averaging', 'conversion_time', 'max_current'].some((k) => err(k))
  const showAdvanced = open || advancedError
  const averaging = MONITOR_AVERAGING[m.chip]
  const ina3221 = m.chip === 'ina3221'
  const ina260 = m.chip === 'ina260'
  const onChip = (v: string | null) => {
    if (!v) return
    const chip = v as MonitorChip
    const patch: Record<string, unknown> = { chip }
    if (chip === 'ina260') patch.shunt_ohm = undefined
    else if (m.chip === 'ina260') patch.shunt_ohm = 10
    patch.channel = chip === 'ina3221' ? (m.channel ?? 1) : undefined
    if (m.averaging !== undefined && !MONITOR_AVERAGING[chip].includes(m.averaging)) patch.averaging = undefined
    update(patch)
  }
  return (
    <Paper withBorder radius="md" p="xs" data-testid={`monitor-${index}`}>
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="xs" fw={600} truncate>
            {m.name || monitorDefaultName(m)}
          </Text>
          <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Remove monitor ${index + 1}`} onClick={remove} disabled={disabled}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </ActionIcon>
        </Group>
        <SimpleGrid cols={3} spacing="xs">
          <Select
            size="xs"
            label="Chip"
            data={[...MONITOR_CHIPS]}
            value={m.chip}
            onChange={onChip}
            allowDeselect={false}
            error={err('chip')}
            disabled={disabled}
            comboboxProps={{ withinPortal: true }}
          />
          <AddrField value={m.addr} onValue={(addr) => update({ addr })} error={err('addr')} disabled={disabled} />
          <NumberField
            label="Shunt (ohm)"
            value={m.shunt_ohm}
            onValue={(shunt_ohm) => update({ shunt_ohm })}
            placeholder={ina260 ? String(INA260_SHUNT_OHM) : '10'}
            error={err('shunt_ohm')}
            disabled={disabled || ina260}
          />
        </SimpleGrid>
        <SimpleGrid cols={ina3221 ? 2 : 1} spacing="xs">
          <TextInput
            size="xs"
            label="Name"
            placeholder={monitorDefaultName(m)}
            value={m.name ?? ''}
            maxLength={32}
            onChange={(e) => update({ name: e.currentTarget.value === '' ? undefined : e.currentTarget.value })}
            error={err('name')}
            disabled={disabled}
          />
          {ina3221 ? (
            <Select
              size="xs"
              label="Channel"
              data={['1', '2', '3']}
              value={String(m.channel ?? 1)}
              onChange={(v) => v && update({ channel: Number(v) })}
              allowDeselect={false}
              error={err('channel')}
              disabled={disabled}
            />
          ) : null}
        </SimpleGrid>
        <Anchor component="button" type="button" size="xs" ta="left" onClick={() => setOpen((o) => !o)} aria-expanded={showAdvanced}>
          {showAdvanced ? 'Hide advanced' : 'Advanced'}
        </Anchor>
        <Collapse expanded={showAdvanced}>
          <Stack gap="xs">
            <SimpleGrid cols={2} spacing="xs">
              <NumberField
                label="SDA (LA)"
                value={m.sda}
                onValue={(sda) => update({ sda })}
                placeholder={wiring.i2c_sda ? `LA${wiring.i2c_sda}` : 'LA1-LA14'}
                error={err('sda')}
                disabled={disabled}
                integer
              />
              <NumberField
                label="SCL (LA)"
                value={m.scl}
                onValue={(scl) => update({ scl })}
                placeholder={wiring.i2c_scl ? `LA${wiring.i2c_scl}` : 'LA1-LA14'}
                error={err('scl')}
                disabled={disabled}
                integer
              />
            </SimpleGrid>
            <SimpleGrid cols={3} spacing="xs">
              <Select
                size="xs"
                label="Averaging"
                data={averaging.map(String)}
                value={m.averaging === undefined ? null : String(m.averaging)}
                placeholder="Default"
                clearable
                onChange={(v) => update({ averaging: v ? Number(v) : undefined })}
                error={err('averaging')}
                disabled={disabled}
                comboboxProps={{ withinPortal: true }}
              />
              <NumberField
                label="Conversion (s)"
                value={m.conversion_time}
                onValue={(conversion_time) => update({ conversion_time })}
                placeholder="0.0011"
                error={err('conversion_time')}
                disabled={disabled}
              />
              <NumberField
                label="Max current (A)"
                value={m.max_current}
                onValue={(max_current) => update({ max_current })}
                placeholder="0.001"
                error={err('max_current')}
                disabled={disabled}
              />
            </SimpleGrid>
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  )
}

export function MonitorsEditor({
  wiring,
  onChange,
  errors,
  disabled,
}: {
  wiring: Wiring
  onChange: (patch: Partial<Wiring>) => void
  errors?: Map<string, string>
  disabled?: boolean
}) {
  const list = wiring.monitors ?? []
  const set = (next: WiringMonitor[]) => onChange({ monitors: next.length ? next : undefined })
  const listError = errors?.get('monitors')
  return (
    <Stack gap="xs" data-testid="monitors-editor">
      <Group gap={4} wrap="nowrap">
        <Text fw={600} size="sm">
          Current monitors
        </Text>
        <HelpTip label="current monitors" docs={DOCS}>
          INA current-monitor breakouts on the I2C pins. The SDK attaches them when it connects, so the power calls can read
          them with monitor=.
        </HelpTip>
      </Group>
      {list.map((m, i) => (
        <MonitorCard
          key={i}
          m={m}
          index={i}
          wiring={wiring}
          errors={errors}
          disabled={disabled}
          update={(patch) => {
            const next = { ...m, ...patch } as Record<string, unknown>
            for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k]
            set(list.map((x, j) => (j === i ? (next as WiringMonitor) : x)))
          }}
          remove={() => set(list.filter((_, j) => j !== i))}
        />
      ))}
      {listError ? (
        <Text size="xs" c="red">
          {listError}
        </Text>
      ) : null}
      <Group>
        <Button
          size="xs"
          variant="default"
          disabled={disabled || list.length >= MAX_WIRING_MONITORS}
          onClick={() => set([...list, { chip: 'ina226', addr: freeAddr(list, 'ina226'), shunt_ohm: 10 }])}
        >
          Add monitor
        </Button>
      </Group>
    </Stack>
  )
}
