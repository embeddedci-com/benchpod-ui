import { Badge, Box, Button, Checkbox, Group, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import type { BusLogRow, BusStatus } from './busLog'

// One log for every tab of the bus console, newest first. A table when there is room; below
// STACK_BELOW px a row per call with Out and In on lines of their own, so a narrow column never
// squeezes the bytes to one character per line. Bytes wrap between bytes, never inside one.

/** Narrower than this (px), the log stacks each row. */
export const STACK_BELOW = 560

/** Wrap at the spaces between bytes, not inside a byte. */
const BYTES = { whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word' } as const

const STATUS: Record<BusStatus, { label: string; color: string }> = {
  ack: { label: 'ACK', color: 'teal' },
  nack: { label: 'NACK', color: 'orange' },
  ok: { label: 'OK', color: 'gray' },
  timeout: { label: 'timeout', color: 'orange' },
  error: { label: 'error', color: 'red' },
  declined: { label: 'not run', color: 'gray' },
}

function clock(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export function TransactionLog({
  rows,
  onClear,
  onShowCapture,
  selected,
  onToggle,
  maxHeight = 260,
  layout = 'auto',
}: {
  rows: BusLogRow[]
  onClear: () => void
  /** Saved sequences: the rows picked to save, and a checkbox per row when onToggle is given. */
  selected?: ReadonlySet<number>
  onToggle?: (id: number) => void
  /** A row from send and capture: show its capture in the trace. */
  onShowCapture?: (seq: number) => void
  maxHeight?: number
  /** 'auto' (default): a table, stacked rows when the log is narrower than STACK_BELOW. */
  layout?: 'auto' | 'table' | 'stacked'
}) {
  const { ref, width } = useElementSize()
  const stacked = layout === 'stacked' || (layout === 'auto' && width > 0 && width < STACK_BELOW)
  const select = (r: BusLogRow) =>
    onToggle ? (
      <Checkbox size="xs" aria-label={`Select ${r.out}`} checked={!!selected?.has(r.id)} disabled={!r.args || r.status === 'error' || r.status === 'declined'} onChange={() => onToggle(r.id)} />
    ) : null
  const result = (r: BusLogRow) => {
    const s = STATUS[r.status]
    return (
      <Group gap={6} wrap="nowrap" align="flex-start">
        <Badge size="xs" variant="light" color={s.color} style={{ flexShrink: 0 }}>
          {s.label}
        </Badge>
        {r.capture && onShowCapture ? (
          <Button size="compact-xs" variant="light" onClick={() => onShowCapture(r.capture!)} style={{ flexShrink: 0 }}>
            Trace
          </Button>
        ) : null}
        {r.note ? (
          <Text size="xs" c={r.status === 'error' ? 'red' : 'dimmed'} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', minWidth: 0 }}>
            {r.note}
          </Text>
        ) : null}
      </Group>
    )
  }
  return (
    <Box ref={ref}>
      <Group justify="space-between" gap="xs">
        <Text size="xs" fw={600}>
          Log
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={onClear} disabled={!rows.length}>
          Clear
        </Button>
      </Group>
      {rows.length === 0 ? (
        <Text size="xs" c="dimmed">
          Every call from these tabs shows here: what went out, what came back, ACK or NACK.
        </Text>
      ) : stacked ? (
        <ScrollArea.Autosize mah={maxHeight}>
          <Stack gap={0} data-testid="bus-log" data-layout="stacked" role="list" aria-label="Log">
            {[...rows].reverse().map((r) => (
              <Box key={r.id} role="listitem" py={4} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Group gap={6} wrap="nowrap" align="flex-start">
                  {select(r)}
                  <Text size="xs" ff="monospace" c="dimmed" style={{ flexShrink: 0 }}>
                    {clock(r.time)}
                  </Text>
                  <Text size="xs" fw={600} style={{ flexShrink: 0 }}>
                    {r.proto}
                  </Text>
                  <Box style={{ minWidth: 0, flex: 1 }}>{result(r)}</Box>
                </Group>
                {r.out ? (
                  <Text size="xs" ff="monospace" style={BYTES}>
                    <Text span size="xs" c="dimmed" ff="inherit">
                      Out{' '}
                    </Text>
                    {r.out}
                  </Text>
                ) : null}
                {r.in ? (
                  <Text size="xs" ff="monospace" style={BYTES}>
                    <Text span size="xs" c="dimmed" ff="inherit">
                      In{' '}
                    </Text>
                    {r.in}
                  </Text>
                ) : null}
              </Box>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      ) : (
        <ScrollArea.Autosize mah={maxHeight}>
          <Table striped withTableBorder fz="xs" verticalSpacing={2} horizontalSpacing={6} data-testid="bus-log">
            <Table.Thead>
              <Table.Tr>
                {onToggle ? <Table.Th w={24} /> : null}
                <Table.Th w={92}>Time</Table.Th>
                <Table.Th w={48}>Bus</Table.Th>
                <Table.Th>Out</Table.Th>
                <Table.Th>In</Table.Th>
                <Table.Th>Result</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...rows].reverse().map((r) => {
                return (
                  <Table.Tr key={r.id}>
                    {onToggle ? <Table.Td>{select(r)}</Table.Td> : null}
                    <Table.Td ff="monospace" c="dimmed">
                      {clock(r.time)}
                    </Table.Td>
                    <Table.Td>{r.proto}</Table.Td>
                    <Table.Td ff="monospace" style={BYTES}>
                      {r.out}
                    </Table.Td>
                    <Table.Td ff="monospace" style={BYTES}>
                      {r.in}
                    </Table.Td>
                    <Table.Td>{result(r)}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
    </Box>
  )
}
