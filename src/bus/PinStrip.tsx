import { useCallback, useEffect, useRef, useState } from 'react'
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
  [WARN_PULL_UNDER_PUSH_PULL]: 'A pull resistor is on under a pin the pod drives. It only wastes current: switch the pull off or use open drain.',
  [WARN_UNPOWERED_DUT]:
    'High or pulled up while the board is off. That can power the board through its I/O pins. Ignore it if the board has its own supply.',
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

/** The pin's warnings as short lines for under the strip: "LA6: a pull-up is on under a pin the pod drives; switch the pull-up off". */
export function pinWarningLines(p: LaPin): string[] {
  const bits = warnBits(p)
  const pull = p.pull === 'down' ? 'pull-down' : p.pull === 'up' ? 'pull-up' : 'pull resistor'
  const out: string[] = []
  if (bits & WARN_PULL_UNDER_PUSH_PULL) out.push(`LA${p.la}: a ${pull} is on under a pin the pod drives; switch the ${pull} off or use open drain`)
  if (bits & WARN_UNPOWERED_DUT) out.push(`LA${p.la}: high or pulled up while the board is off; this can power the board through the pin`)
  for (const s of p.warnings ?? []) if (!/push-pull|power is off|unpowered/i.test(s)) out.push(/^LA\d+:/.test(s) ? s : `LA${p.la}: ${s}`)
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

/** The owner in one short word for the strip: free, gpio, i2c, uart, swd, spi, sensor, step. */
export function ownerShort(p: LaPin): string {
  const f = p.function
  if (!f || f === 'none') return 'free'
  if (f.startsWith('i2c')) return 'i2c'
  for (const k of ['gpio', 'uart', 'swd', 'spi', 'sensor', 'step']) if (f.startsWith(k)) return k
  return f
}

// The DUT signal's direction in words, from the board's side.
const DIR_LABEL: Record<string, { short: string; long: string }> = {
  dut_input: { short: 'board in', long: 'An input of the board: the pod may drive it.' },
  dut_output: { short: 'board out', long: 'An output of the board: the pod only listens, or uses open drain.' },
  bidir: { short: 'both', long: 'Both sides drive it (open drain, like I2C).' },
}

/** The direction in words: board in, board out, both, not set. */
export function dirLabel(p: LaPin | undefined): string {
  return (p?.dir && DIR_LABEL[p.dir]?.short) || 'not set'
}

/** The pull resistor in words: pull-up on, pull-down off, no pull. */
export function pullLabel(p: LaPin | undefined): string {
  if (!p?.pull) return 'no pull'
  const kind = p.pull === 'down' ? 'pull-down' : p.pull === 'up' ? 'pull-up' : `pull ${p.pull}`
  return `${kind} ${p.pull_on ? 'on' : 'off'}`
}

const SMALL = { fontSize: 10, lineHeight: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

/** The strip shows 14 pins in one row when it has the room, else rows of 7, or of 4 on a phone. */
const CELL_MIN = 74
export function pinColumns(width: number): number {
  if (width === 0 || width >= 14 * CELL_MIN) return 14
  return width >= 7 * CELL_MIN ? 7 : 4
}

export function PinStrip({ call, names, refreshKey, title = 'Pins' }: { call: BenchCall; names?: string[]; refreshKey?: unknown; title?: string }) {
  const [pins, setPins] = useState<LaPins | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [width, setWidth] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((e) => setWidth(e[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
  const warnLines = (pins?.pins ?? []).slice().sort((a, b) => a.la - b.la).flatMap(pinWarningLines)
  const cols = pinColumns(width)

  return (
    <Stack gap={4} data-testid="pin-strip">
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="xs" fw={600}>
            {title}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1} data-testid="pin-legend">
            Each pin: wiring name, what uses it, the board&apos;s direction (board in, board out, both), the pull resistor, the live level.
          </Text>
        </Group>
        <Group gap={6} wrap="nowrap">
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
      <Box ref={boxRef} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 3 }}>
        {Array.from({ length: 14 }, (_, i) => i + 1).map((la) => {
          const p = byLa.get(la)
          const warns = p ? pinWarnings(p) : []
          const level = levels.get(la) ?? (p?.function === 'gpio' && p.gpio !== 'input' ? p.level : undefined)
          const dir = p?.dir ? DIR_LABEL[p.dir] : undefined
          const owned = !!p && p.function !== 'none'
          const name = names?.[la - 1]
          return (
            <Paper
              key={la}
              withBorder
              px={4}
              py={2}
              radius="sm"
              data-testid={`pin-${la}`}
              style={{
                borderColor: warns.length ? 'var(--mantine-color-orange-6)' : undefined,
                background: owned ? 'var(--mantine-color-default-hover)' : undefined,
                minWidth: 0,
              }}
            >
              <Group gap={2} justify="space-between" wrap="nowrap">
                <Text fw={700} ff="monospace" style={{ fontSize: 11, lineHeight: '15px' }}>
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
                    <Text c="orange" fw={700} style={{ fontSize: 10, lineHeight: '15px', cursor: 'help' }} aria-label={`LA${la} warning`}>
                      check
                    </Text>
                  </Tooltip>
                ) : level !== undefined && level !== null ? (
                  <Text c={level ? 'teal' : 'dimmed'} style={{ fontSize: 10, lineHeight: '15px' }} title="Live level">
                    {level ? 'high' : 'low'}
                  </Text>
                ) : null}
              </Group>
              <Text c={name ? undefined : 'dimmed'} style={SMALL} title={name || 'Not in the wiring'}>
                {name || 'not wired'}
              </Text>
              <Text c={owned ? undefined : 'dimmed'} fw={owned ? 600 : undefined} style={SMALL} title={p ? `Used by: ${ownerLabel(p)}` : undefined}>
                {p ? ownerShort(p) : 'unknown'}
              </Text>
              <Text c={dir ? undefined : 'dimmed'} style={SMALL} title={dir?.long ?? 'Direction not set: the pod treats the pin as unknown.'}>
                {dirLabel(p)}
              </Text>
              <Text c={p?.pull_on ? undefined : 'dimmed'} style={SMALL} title={p?.pull ? `${p.pull_ohms ?? ''} ${pullLabel(p)}`.trim() : 'No pull resistor on this pin'}>
                {p ? pullLabel(p) : ''}
              </Text>
            </Paper>
          )
        })}
      </Box>
      {warnLines.length ? (
        <Stack gap={0} data-testid="pin-warnings">
          {warnLines.map((w) => (
            <Text key={w} size="xs" c="orange.8">
              {w}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}
