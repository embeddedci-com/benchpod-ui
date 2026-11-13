import { Badge, Button, Group, ScrollArea, Table, Text } from '@mantine/core'
import type { BusLogRow, BusStatus } from './busLog'

// One log for every tab of the bus console, newest first.

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

export function TransactionLog({ rows, onClear, maxHeight = 260 }: { rows: BusLogRow[]; onClear: () => void; maxHeight?: number }) {
  return (
    <>
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
      ) : (
        <ScrollArea.Autosize mah={maxHeight}>
          <Table striped withTableBorder fz="xs" verticalSpacing={2} horizontalSpacing={6} data-testid="bus-log">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={92}>Time</Table.Th>
                <Table.Th w={48}>Bus</Table.Th>
                <Table.Th>Out</Table.Th>
                <Table.Th>In</Table.Th>
                <Table.Th>Result</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...rows].reverse().map((r) => {
                const s = STATUS[r.status]
                return (
                  <Table.Tr key={r.id}>
                    <Table.Td ff="monospace" c="dimmed">
                      {clock(r.time)}
                    </Table.Td>
                    <Table.Td>{r.proto}</Table.Td>
                    <Table.Td ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                      {r.out}
                    </Table.Td>
                    <Table.Td ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                      {r.in}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap" align="flex-start">
                        <Badge size="xs" variant="light" color={s.color} style={{ flexShrink: 0 }}>
                          {s.label}
                        </Badge>
                        {r.note ? (
                          <Text size="xs" c={r.status === 'error' ? 'red' : 'dimmed'} style={{ whiteSpace: 'pre-wrap' }}>
                            {r.note}
                          </Text>
                        ) : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
    </>
  )
}
