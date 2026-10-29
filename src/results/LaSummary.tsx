import { Box, Group, Table, Text, Tooltip } from '@mantine/core'
import { fmtSi } from './AdcEnvelope'

/** The MCP server's capture_la result: per-channel summaries (the edges stay on the pod side). */
export type LaCapture = {
  samples: number
  sample_rate_hz: number
  duration: number
  trigger?: string | null
  channels: {
    la: number
    initial: number
    final: number
    edges: number
    high_fraction: number
    first_edge?: number | null
    est_frequency_hz?: number | null
  }[]
}

export function isLaCapture(v: unknown): v is LaCapture {
  const o = v as LaCapture
  return !!o && Array.isArray(o.channels) && typeof o.sample_rate_hz === 'number' && o.channels.every((c) => typeof c.la === 'number')
}

// The same per-channel colours as the web UI's capture view.
export const LA_PALETTE = ['#2f9e44', '#1c7ed6', '#f08c00', '#ae3ec9', '#e64980', '#0ca678', '#4263eb', '#fa5252', '#7048e8', '#12b886', '#e8590c', '#1098ad', '#5c940d', '#d6336c']

/** A logic capture as a table of channels: activity bar, edges, duty and frequency. */
export function LaSummary({ capture, names }: { capture: LaCapture; names?: Record<number, string> }) {
  const active = capture.channels.filter((c) => c.edges > 0 || c.initial !== 0)
  const rows = active.length ? active : capture.channels
  return (
    <Box>
      <Group gap="md" mb={4}>
        <Text size="xs" ff="monospace" c="dimmed">
          {fmtSi(capture.sample_rate_hz, 'S/s')} · {fmtSi(capture.duration, 's')} · {capture.samples.toLocaleString()} samples
          {capture.trigger ? ` · trigger ${capture.trigger}` : ''}
        </Text>
      </Group>
      <Table fz="xs" verticalSpacing={2} ff="monospace">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>ch</Table.Th>
            <Table.Th style={{ width: '40%' }}>high</Table.Th>
            <Table.Th>edges</Table.Th>
            <Table.Th>freq</Table.Th>
            <Table.Th>first edge</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((c) => (
            <Table.Tr key={c.la}>
              <Table.Td>
                <Text span size="xs" ff="monospace" c={LA_PALETTE[(c.la - 1) % LA_PALETTE.length]} fw={600}>
                  LA{c.la}
                </Text>
                {names?.[c.la] ? <Text span size="xs" c="dimmed"> {names[c.la]}</Text> : null}
              </Table.Td>
              <Table.Td>
                <Tooltip label={`${(c.high_fraction * 100).toFixed(1)} % high`}>
                  <Box style={{ height: 8, borderRadius: 4, background: 'var(--mantine-color-default-border)', overflow: 'hidden' }}>
                    <Box style={{ height: 8, width: `${c.high_fraction * 100}%`, background: LA_PALETTE[(c.la - 1) % LA_PALETTE.length] }} />
                  </Box>
                </Tooltip>
              </Table.Td>
              <Table.Td>{c.edges.toLocaleString()}</Table.Td>
              <Table.Td>{c.est_frequency_hz ? fmtSi(c.est_frequency_hz, 'Hz') : '—'}</Table.Td>
              <Table.Td>{c.first_edge != null ? fmtSi(c.first_edge, 's') : '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  )
}
