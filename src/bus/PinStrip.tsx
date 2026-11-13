import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Box, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'

// All 14 LA channels in one row, from the la_pins tool: the wiring's name, what owns the pin, which
// way the DUT signal goes, the live level, the pull resistor and the pod's warnings. The bus
// console refreshes it after each of its calls (refreshKey).

/** One channel as the la_pins tool reports it. */
export type LaPin = {
  la: number
  function: string
  gpio?: string | null
  level?: number | null
  pull?: string | null
  pull_ohms?: string | null
  pull_on?: boolean
  in_use?: boolean
  /** dut_input, dut_output, bidir, unknown, or null */
  dir?: string | null
  /** Warning bits from the pod: 1 = a pull under a push-pull output, 2 = high or pulled up with target power off. */
  warn?: number
  /** The same warnings as sentences (the MCP tool sends these). */
  warnings?: string[] | null
}
export type LaPins = { pins: LaPin[]; levels?: { la: number; level: number }[] | null }

export const WARN_PULL_UNDER_PUSH_PULL = 1
export const WARN_UNPOWERED_DUT = 2

const WARN_TEXT: Record<number, string> = {
  [WARN_PULL_UNDER_PUSH_PULL]: 'A pull resistor is on under a push-pull output. It only wastes current: use open drain or switch the pull off.',
  [WARN_UNPOWERED_DUT]:
    'Target power is off while this pin is high or pulled up. That can power the board through its I/O pins. Ignore it if the board has its own supply.',
}

/** The pin's warning bits: the pod's `warn`, else read from its sentences. */
export function warnBits(p: LaPin): number {
  if (typeof p.warn === 'number') return p.warn
  let w = 0
  for (const s of p.warnings ?? []) {
    if (/push-pull/i.test(s)) w |= WARN_PULL_UNDER_PUSH_PULL
    else if (/power is off|unpowered/i.test(s)) w |= WARN_UNPOWERED_DUT
  }
  return w
}

/** Plain explanations of a pin's warnings; a sentence the UI does not know is shown as the pod sent it. */
export function pinWarnings(p: LaPin): string[] {
  const bits = warnBits(p)
  const out = [WARN_PULL_UNDER_PUSH_PULL, WARN_UNPOWERED_DUT].filter((b) => bits & b).map((b) => WARN_TEXT[b])
  for (const s of p.warnings ?? []) if (!/push-pull|power is off|unpowered/i.test(s)) out.push(s)
  return out
}

/** Who owns the pin, short: free, gpio out, I2C SDA, UART RX, SWD, sensor. */
export function ownerLabel(p: LaPin): string {
  const f = p.function
  if (!f || f === 'none') return 'free'
  if (f === 'gpio') return p.gpio === 'open_drain' ? 'gpio od' : p.gpio === 'input' ? 'gpio in' : 'gpio out'
  const m = /^i2cm?_(sda|scl)$/.exec(f)
  if (m) return `I2C ${m[1].toUpperCase()}`
  if (f.startsWith('uart_')) return `UART ${f.slice(5).toUpperCase()}`
  if (f.startsWith('swd_')) return 'SWD'
  if (f.startsWith('spi_')) return `SPI ${f.slice(4).toUpperCase()}`
  if (f.startsWith('sensor')) return 'sensor'
  if (f.startsWith('step')) return 'step'
  return f
}

const DIR_LABEL: Record<string, { short: string; long: string }> = {
  dut_input: { short: '→ DUT', long: 'The board reads this pin: the pod may drive it.' },
  dut_output: { short: 'DUT →', long: 'The board drives this pin: the pod only listens or uses open drain.' },
  bidir: { short: '↔', long: 'Both drive this pin (open drain, like I2C).' },
}

function pullLabel(p: LaPin): string {
  if (!p.pull) return 'n/a'
  return p.pull_on ? p.pull : 'off'
}

export function PinStrip({ call, names, refreshKey }: { call: BenchCall; names?: string[]; refreshKey?: unknown }) {
  const [pins, setPins] = useState<LaPins | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await call('la_pins', {}, { poll: true })
      const d = benchData<LaPins>(r)
      setError(benchError(r))
      if (d?.pins) setPins(d)
    } finally {
      setBusy(false)
    }
  }, [call])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const levels = new Map((pins?.levels ?? []).map((l) => [l.la, l.level]))
  const byLa = new Map((pins?.pins ?? []).map((p) => [p.la, p]))

  return (
    <Stack gap={4}>
      <Group gap="xs" justify="space-between">
        <Text size="xs" fw={600}>
          Pins
        </Text>
        <Group gap={6}>
          {error ? (
            <Text size="xs" c="red" lineClamp={1} title={error}>
              {error}
            </Text>
          ) : null}
          <Tooltip label="Read the pins again">
            <ActionIcon size="sm" variant="subtle" onClick={() => void load()} loading={busy} aria-label="Refresh pins">
              ↻
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(14, minmax(56px, 1fr))', gap: 4, overflowX: 'auto' }}>
        {Array.from({ length: 14 }, (_, i) => i + 1).map((la) => {
          const p = byLa.get(la)
          const warns = p ? pinWarnings(p) : []
          const level = levels.get(la) ?? (p?.function === 'gpio' && p.gpio !== 'input' ? p.level : undefined)
          const dir = p?.dir ? DIR_LABEL[p.dir] : undefined
          const owned = !!p && p.function !== 'none'
          return (
            <Paper
              key={la}
              withBorder
              p={4}
              radius="sm"
              data-testid={`pin-${la}`}
              style={{
                borderColor: warns.length ? 'var(--mantine-color-orange-6)' : undefined,
                background: owned ? 'var(--mantine-color-default-hover)' : undefined,
                minWidth: 0,
              }}
            >
              <Group gap={2} justify="space-between" wrap="nowrap">
                <Text size="xs" fw={700} ff="monospace">
                  LA{la}
                </Text>
                {warns.length ? (
                  <Tooltip
                    multiline
                    w={260}
                    withArrow
                    label={
                      <Stack gap={4}>
                        {warns.map((w) => (
                          <Text key={w} size="xs">
                            {w}
                          </Text>
                        ))}
                      </Stack>
                    }
                  >
                    <Text size="xs" c="orange" fw={700} aria-label={`LA${la} warning`} style={{ cursor: 'help' }}>
                      ⚠
                    </Text>
                  </Tooltip>
                ) : level !== undefined && level !== null ? (
                  <Text size="xs" ff="monospace" c={level ? 'teal' : 'dimmed'} title="Live level">
                    {level}
                  </Text>
                ) : null}
              </Group>
              <Text size="xs" lineClamp={1} title={names?.[la - 1] || undefined} c={names?.[la - 1] ? undefined : 'dimmed'}>
                {names?.[la - 1] || '·'}
              </Text>
              <Text size="xs" c={owned ? undefined : 'dimmed'} lineClamp={1}>
                {p ? ownerLabel(p) : '?'}
              </Text>
              <Group gap={4} wrap="nowrap" justify="space-between">
                <Text size="xs" c="dimmed" title={dir?.long ?? 'Direction not set'}>
                  {dir?.short ?? '?'}
                </Text>
                <Text size="xs" c={p?.pull_on ? undefined : 'dimmed'} title={p?.pull ? `${p.pull_ohms ?? ''} pull ${p.pull}, ${p.pull_on ? 'on' : 'off'}`.trim() : 'No pull resistor on this pin'}>
                  {p ? pullLabel(p) : ''}
                </Text>
              </Group>
            </Paper>
          )
        })}
      </Box>
    </Stack>
  )
}
