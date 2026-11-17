import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Group, Paper, Select, SimpleGrid, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core'
import { ownerLabel, pinWarnings, type LaPin } from '../bus/PinStrip'
import { LA_CHANNEL_COUNT, WIRING_ROLES, type Wiring, type WiringFieldIssue, type WiringRole } from './model'
import {
  assignPin,
  PIN_ROLE_OPTIONS,
  pinUseChoice,
  pinViews,
  pullSwitchLabel,
  roleKind,
  setPinPull,
  SIGNAL_USE_LABELS,
  signalUse,
  updateSignal,
  type PinKind,
  type PinUseChoice,
  type PinView,
  type SignalUse,
} from './pins'

// The Pins editor: one wiring profile, pin by pin. The 14 LA pins in two rows, colored by what
// they carry, with a dot for a pull resistor that is on; click a pin to set what it is used for,
// its name and direction when it is a signal, its pull resistor, and the settings of its protocol
// (UART baud on the UART pins, and so on). The I/O voltage and power rail the board is powered
// with sit above. Host-neutral and controlled: it reads `wiring` and reports each change as a patch.

export const PIN_KIND_COLORS: Record<PinKind, string> = { uart: 'blue', i2c: 'teal', swd: 'violet', spi: 'orange', signal: 'cyan' }
const PIN_KIND_LABELS: Record<PinKind, string> = { uart: 'UART', i2c: 'I2C', swd: 'SWD', spi: 'SPI', signal: 'Signal' }
const PULL_UP_COLOR = 'var(--mantine-color-red-6)'
const PULL_DOWN_COLOR = 'var(--mantine-color-indigo-6)'
const BAUDS = ['9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600', '1000000']

function PullDot({ dir, size = 7 }: { dir: 'up' | 'down'; size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: dir === 'up' ? PULL_UP_COLOR : PULL_DOWN_COLOR }}
    />
  )
}

/** The fields of the profile that belong to a pin, for its error border. */
function pinFields(p: PinView): string[] {
  return p.users.map((u) => (u.kind === 'role' ? u.role : `signals[${u.index}]`))
}

function PinTile({ p, selected, error, warned, onClick }: { p: PinView; selected: boolean; error: boolean; warned: boolean; onClick: () => void }) {
  const color = p.kind ? PIN_KIND_COLORS[p.kind] : null
  const bad = error || p.users.length > 1
  return (
    <UnstyledButton
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`pin-tile-${p.la}`}
      aria-label={`LA${p.la}: ${p.short}${p.pullOn && p.pull.dir ? `, pull-${p.pull.dir} on` : ''}${warned ? ', warning' : ''}`}
      style={{
        position: 'relative',
        minWidth: 0,
        height: 46,
        padding: '3px 2px',
        borderRadius: 'var(--mantine-radius-sm)',
        textAlign: 'center',
        background: color ? `var(--mantine-color-${color}-light)` : 'var(--mantine-color-body)',
        color: color ? `var(--mantine-color-${color}-light-color)` : 'var(--mantine-color-dimmed)',
        border: `1px solid ${bad ? 'var(--mantine-color-red-6)' : color ? `var(--mantine-color-${color}-outline)` : 'var(--mantine-color-default-border)'}`,
        outline: selected ? '2px solid var(--mantine-primary-color-filled)' : undefined,
        outlineOffset: 1,
      }}
    >
      {warned ? (
        <Text c="orange.7" fw={700} style={{ position: 'absolute', top: 1, left: 4, fontSize: 10, lineHeight: '12px' }} aria-hidden>
          !
        </Text>
      ) : null}
      {p.pullOn && p.pull.dir ? (
        <Box style={{ position: 'absolute', top: 3, right: 4, lineHeight: 0 }}>
          <PullDot dir={p.pull.dir} />
        </Box>
      ) : null}
      <Text fw={600} ff="monospace" style={{ fontSize: 11, lineHeight: '15px' }}>
        LA{p.la}
      </Text>
      <Text truncate style={{ fontSize: 10, lineHeight: '13px' }}>
        {p.users.length > 1 ? 'used twice' : p.short}
      </Text>
    </UnstyledButton>
  )
}

const NONE = 'none'
const SIGNAL = 'signal'

export function PinsEditor({
  wiring,
  onChange,
  errors,
  warnings,
  disabled,
  initialPin = 1,
  live,
}: {
  /** The profile, effective (defaults filled in). */
  wiring: Wiring
  /** One change to the profile, as a patch of its keys. */
  onChange: (patch: Partial<Wiring>) => void
  /** Field errors by profile key (uart_rx, signals[0].name, ...). */
  errors?: Map<string, string>
  warnings?: WiringFieldIssue[]
  disabled?: boolean
  initialPin?: number
  /** What the pod reports for each pin right now (la_pins), when the host reads it: warnings, live level, owner. */
  live?: LaPin[] | null
}) {
  const [sel, setSel] = useState(initialPin)
  const [picked, setPicked] = useState(false)
  // Until a pin is clicked, show the first one the pod has a warning for (the read can come later).
  const firstWarned = live?.find((x) => pinWarnings(x).length)?.la
  useEffect(() => {
    if (!picked && firstWarned) setSel(firstWarned)
  }, [picked, firstWarned])
  const liveOf = (la: number) => live?.find((x) => x.la === la)
  const pins = useMemo(() => pinViews(wiring), [wiring])
  const p = pins[Math.min(Math.max(sel, 1), LA_CHANNEL_COUNT) - 1]
  const fieldErr = (f: string) => errors?.get(f)
  const pinHasError = (v: PinView) => pinFields(v).some((f) => [...(errors?.keys() ?? [])].some((k) => k === f || k.startsWith(`${f}.`)))
  const kinds = useMemo(() => [...new Set(pins.map((x) => x.kind).filter((k): k is PinKind => !!k))], [pins])
  const anyPull = pins.some((x) => x.pullOn)

  const where = (role: WiringRole) => wiring[role]
  const useData = [
    { value: NONE, label: 'Not used' },
    ...PIN_ROLE_OPTIONS.map(({ role, label }) => {
      const at = where(role)
      return { value: role, label: at && at !== p.la ? `${label}, now on LA${at}` : label }
    }),
    { value: SIGNAL, label: 'Signal (a name of your own)' },
  ]
  const choice = pinUseChoice(p)
  const user = p.users[0]
  const sig = user?.kind === 'signal' ? user : null
  const role = user?.kind === 'role' ? user.role : null
  const kind = role ? roleKind(role) : null
  const pullLabel = pullSwitchLabel(p.pull)
  const low = wiring.la_mv === 1800

  return (
    <Stack gap="sm">
      <Group gap="sm" grow wrap="nowrap" align="flex-start">
        <Select
          size="xs"
          label="I/O voltage"
          data={[
            { value: '0', label: 'Not set' },
            { value: '3300', label: '3.3 V' },
            { value: '1800', label: '1.8 V' },
          ]}
          value={String(wiring.la_mv || 0)}
          onChange={(v) => v != null && onChange({ la_mv: Number(v) || undefined })}
          allowDeselect={false}
          error={fieldErr('la_mv')}
          disabled={disabled}
        />
        <Select
          size="xs"
          label="Board power"
          data={[
            { value: '0', label: 'Not set' },
            { value: '1', label: 'Internal 5 V' },
            { value: '2', label: 'External supply' },
          ]}
          value={String(wiring.efuse || 0)}
          onChange={(v) => v != null && onChange({ efuse: Number(v) || undefined })}
          allowDeselect={false}
          error={fieldErr('efuse')}
          disabled={disabled}
        />
      </Group>

      <SimpleGrid cols={7} spacing={4} verticalSpacing={4}>
        {pins.map((x) => (
          <PinTile
            key={x.la}
            p={x}
            selected={x.la === p.la}
            error={pinHasError(x)}
            warned={(() => {
              const l = liveOf(x.la)
              return !!l && pinWarnings(l).length > 0
            })()}
            onClick={() => {
              setPicked(true)
              setSel(x.la)
            }}
          />
        ))}
      </SimpleGrid>
      <Group gap={10} wrap="wrap">
        {kinds.map((k) => (
          <Group key={k} gap={4} wrap="nowrap">
            <Box w={10} h={10} style={{ borderRadius: 2, background: `var(--mantine-color-${PIN_KIND_COLORS[k]}-light)`, border: `1px solid var(--mantine-color-${PIN_KIND_COLORS[k]}-outline)` }} />
            <Text size="xs" c="dimmed">
              {PIN_KIND_LABELS[k]}
            </Text>
          </Group>
        ))}
        {anyPull || kinds.length ? (
          <>
            <Group gap={4} wrap="nowrap">
              <PullDot dir="up" />
              <Text size="xs" c="dimmed">
                pull-up on
              </Text>
            </Group>
            <Group gap={4} wrap="nowrap">
              <PullDot dir="down" />
              <Text size="xs" c="dimmed">
                pull-down on
              </Text>
            </Group>
          </>
        ) : null}
      </Group>

      <Paper withBorder radius="md" p="sm">
        <Stack gap="xs">
          <Text fw={600} size="sm">
            LA{p.la}
            {p.users.length === 1 ? ` · ${p.short}` : ''}
          </Text>
          {(() => {
            const l = liveOf(p.la)
            if (!l) return null
            const warns = pinWarnings(l)
            const level = typeof l.level === 'number' ? (l.level ? 'high' : 'low') : null
            return (
              <Stack gap={2} data-testid="pin-live">
                <Text size="xs" c="dimmed">
                  On the pod now: {ownerLabel(l)}
                  {level ? `, ${level}` : ''}
                  {l.pull_on ? `, pull-${l.pull === 'down' ? 'down' : 'up'} on` : ''}
                </Text>
                {warns.map((w) => (
                  <Text key={w} size="xs" c="orange.8">
                    {w}
                  </Text>
                ))}
              </Stack>
            )
          })()}
          {p.users.length > 1 ? (
            <Alert color="red" variant="light" p="xs">
              <Text size="xs">
                LA{p.la} is used for {p.users.map((u) => u.label).join(' and ')}. A pin carries one signal: pick what it&apos;s used for.
              </Text>
            </Alert>
          ) : null}
          <Select
            size="xs"
            label="Used for"
            data={useData}
            value={p.users.length > 1 ? null : choice}
            placeholder="Pick one"
            onChange={(v) => v && onChange(assignPin(wiring, p.la, v as PinUseChoice))}
            allowDeselect={false}
            error={role ? fieldErr(role) : undefined}
            disabled={disabled}
            comboboxProps={{ withinPortal: true }}
            maxDropdownHeight={320}
          />

          {sig && p.users.length === 1 ? (
            <>
              <TextInput
                size="xs"
                label="Name"
                description={`Captures label the pin with it, and the SDK finds it: bp.signal("${sig.signal.name || 'NAME'}").`}
                value={sig.signal.name}
                maxLength={32}
                onChange={(e) => onChange(updateSignal(wiring, sig.index, { name: e.currentTarget.value }))}
                error={fieldErr(`signals[${sig.index}].name`) ?? fieldErr(`signals[${sig.index}].la`)}
                disabled={disabled}
              />
              <Select
                size="xs"
                label="The pod"
                data={(Object.keys(SIGNAL_USE_LABELS) as SignalUse[]).map((u) => ({ value: u, label: SIGNAL_USE_LABELS[u] }))}
                value={signalUse(sig.signal)}
                onChange={(v) => v && onChange(updateSignal(wiring, sig.index, { use: v as SignalUse }))}
                allowDeselect={false}
                disabled={disabled}
              />
            </>
          ) : null}

          {kind === 'uart' ? (
            <Select
              size="xs"
              label="Baud (both UART pins)"
              data={BAUDS.includes(String(wiring.uart_baud)) ? BAUDS : [...BAUDS, String(wiring.uart_baud)]}
              value={String(wiring.uart_baud)}
              onChange={(v) => v && onChange({ uart_baud: Number(v) })}
              allowDeselect={false}
              searchable
              error={fieldErr('uart_baud')}
              disabled={disabled}
            />
          ) : null}
          {kind === 'i2c' ? (
            <TextInput
              size="xs"
              label="Emulated sensor address"
              description="The 7-bit address the Sensors tab answers on."
              placeholder="0x76"
              value={wiring.i2c_addr}
              onChange={(e) => onChange({ i2c_addr: e.currentTarget.value })}
              error={fieldErr('i2c_addr')}
              disabled={disabled}
            />
          ) : null}
          {kind === 'swd' ? (
            <>
              <TextInput
                size="xs"
                label="OpenOCD target"
                placeholder="target/stm32f4x.cfg"
                value={wiring.swd_target}
                maxLength={128}
                onChange={(e) => onChange({ swd_target: e.currentTarget.value })}
                error={fieldErr('swd_target')}
                disabled={disabled}
              />
              <Switch
                size="xs"
                label="The board's reset is wired to the pod's reset pin"
                checked={wiring.swd_nreset}
                onChange={(e) => onChange({ swd_nreset: e.currentTarget.checked })}
                disabled={disabled}
              />
            </>
          ) : null}

          {pullLabel && p.pull.dir ? (
            <Switch
              size="xs"
              label={
                <Group gap={6} wrap="nowrap">
                  <span>{pullLabel}</span>
                  <PullDot dir={p.pull.dir} />
                </Group>
              }
              description={
                low
                  ? 'The pull resistors work at 3.3 V only: at 1.8 V it stays off.'
                  : wiring.pulls === null
                    ? 'This profile leaves the pull resistors as they are. Switch one on or off to have power-on set them all.'
                    : 'Switched on or off when the board powers on with this profile.'
              }
              checked={p.pullOn}
              onChange={(e) => onChange(setPinPull(wiring, p.la, e.currentTarget.checked))}
              error={fieldErr('pulls')}
              disabled={disabled}
            />
          ) : (
            <Text size="xs" c="dimmed">
              No pull resistor on this pin.
            </Text>
          )}
        </Stack>
      </Paper>

      {warnings?.length ? (
        <Stack gap={2}>
          {warnings.map((w) => (
            <Text key={w.field + w.message} size="xs" c="orange">
              {pinOf(wiring, w.field)}: {w.message}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}

/** "LA7" for a role key the profile has on a pin, else the field itself. */
function pinOf(w: Wiring, field: string): string {
  if ((WIRING_ROLES as readonly string[]).includes(field)) {
    const la = w[field as WiringRole]
    if (la) return `LA${la}`
  }
  return field === 'pulls' ? 'Pull resistors' : field
}
