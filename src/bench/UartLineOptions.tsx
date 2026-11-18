import { ActionIcon, Checkbox, Group, NumberInput, Popover, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { HelpTip } from '../help/HelpTip'

// One wire and boot entry for the console's uart_open (the MCP's half_duplex and entry; gateware
// v57). Kept in this computer's storage: they describe the bench, like the pins.

export type UartEntryOpts = { reset_ms: number; tx_low: boolean; hold_ms: number; idle_ms: number; hex: string }
export type UartLine = { halfDuplex: boolean; entry: UartEntryOpts | null }

export const UART_ENTRY_DEFAULTS: UartEntryOpts = { reset_ms: 10, tx_low: true, hold_ms: 10, idle_ms: 10, hex: '' }
const KEY = 'benchpod.uartLine'

const ms = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000 ? v : 10)

export function loadUartLine(): UartLine {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<UartLine> | null
    const e = raw?.entry as Partial<UartEntryOpts> | null | undefined
    return {
      halfDuplex: raw?.halfDuplex === true,
      entry:
        e && typeof e === 'object'
          ? { reset_ms: ms(e.reset_ms), tx_low: e.tx_low !== false, hold_ms: ms(e.hold_ms), idle_ms: ms(e.idle_ms), hex: typeof e.hex === 'string' ? e.hex : '' }
          : null,
    }
  } catch {
    return { halfDuplex: false, entry: null }
  }
}

export function saveUartLine(v: UartLine): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* not remembered */
  }
}

/** "00 c5" -> "00c5"; null when it is not whole hex bytes or more than 32. */
export function entryHex(v: string): string | null {
  const s = v.replace(/[\s,]/g, '').replace(/^0x/i, '').toLowerCase()
  return s.length % 2 === 0 && s.length <= 64 && /^[0-9a-f]*$/.test(s) ? s : null
}

/** uart_open's half_duplex and entry arguments; none for a plain two-wire session. */
export function uartLineArgs(v: UartLine): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  if (v.halfDuplex) args.half_duplex = true
  if (v.entry) {
    const { hex, ...rest } = v.entry
    args.entry = { ...rest, data_hex: entryHex(hex) ?? '' }
  }
  return args
}

export function UartLineOptions({ value, onChange }: { value: UartLine; onChange: (v: UartLine) => void }) {
  const entry = value.entry
  const setEntry = (patch: Partial<UartEntryOpts>) => entry && onChange({ ...value, entry: { ...entry, ...patch } })
  const on = value.halfDuplex || !!entry
  const msInput = (key: 'reset_ms' | 'hold_ms' | 'idle_ms', label: string) => (
    <NumberInput
      size="xs"
      label={label}
      suffix=" ms"
      min={0}
      max={1000}
      allowDecimal={false}
      value={entry?.[key]}
      onChange={(n) => setEntry({ [key]: typeof n === 'number' ? Math.max(0, Math.min(1000, n)) : 0 })}
    />
  )
  return (
    <Popover width={280} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon size="sm" variant={on ? 'light' : 'subtle'} color={on ? 'blue' : 'gray'} aria-label="One wire and boot entry">
          ⋯
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6}>
          <Group gap={4} wrap="nowrap">
            <Checkbox size="xs" label="One wire (half duplex)" checked={value.halfDuplex} onChange={(e) => onChange({ ...value, halfDuplex: e.currentTarget.checked })} />
            <HelpTip label="One-wire UART" docs="/docs/benchpod-targets/5v-rs485#one-wire">
              The board sends and answers on the RX pin; TX is not used. The pod only pulls the line low and turns that pin&apos;s pull-up on (LA1 to LA6).
            </HelpTip>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Checkbox
              size="xs"
              label="Boot entry before opening"
              checked={!!entry}
              onChange={(e) => onChange({ ...value, entry: e.currentTarget.checked ? { ...UART_ENTRY_DEFAULTS } : null })}
            />
            <HelpTip label="Boot entry" docs="/docs/benchpod-targets/5v-rs485#boot-entry">
              The pod holds TX low, resets the board, releases TX after the hold time, then sends the first bytes after the idle time, all timed on the pod.
            </HelpTip>
          </Group>
          {entry ? (
            <>
              <SimpleGrid cols={3} spacing="xs">
                {msInput('reset_ms', 'Reset')}
                {msInput('hold_ms', 'Hold')}
                {msInput('idle_ms', 'Idle')}
              </SimpleGrid>
              <Checkbox size="xs" label="TX low through the reset" checked={entry.tx_low} onChange={(e) => setEntry({ tx_low: e.currentTarget.checked })} />
              <TextInput
                size="xs"
                label="First bytes (hex)"
                placeholder="none"
                value={entry.hex}
                onChange={(e) => setEntry({ hex: e.currentTarget.value })}
                error={entryHex(entry.hex) === null ? 'Whole hex bytes, at most 32' : undefined}
              />
            </>
          ) : null}
          {on ? (
            <Text size="xs" c="dimmed">
              Needs pod firmware with gateware v57.
            </Text>
          ) : null}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
