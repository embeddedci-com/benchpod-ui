import { Box, Code, Stack, Table, Text } from '@mantine/core'
import { AdcEnvelope, isAdcCapture } from './AdcEnvelope'
import { LaSummary, isLaCapture } from './LaSummary'

/** A UART log, as a terminal shows it. */
export function TerminalText({ text, maxHeight = 320 }: { text: string; maxHeight?: number }) {
  return (
    <Box
      component="pre"
      style={{
        margin: 0,
        padding: '8px 10px',
        maxHeight,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.45,
        borderRadius: 6,
        background: '#0d1014',
        color: '#d4dae1',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text || '(nothing received)'}
    </Box>
  )
}

function isFlat(o: Record<string, unknown>): boolean {
  return Object.values(o).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))
  return String(v)
}

/**
 * Draws a tool's structured result: a UART log as a terminal, an ADC capture as an envelope,
 * a logic capture as a channel table, a flat object as key/value rows, anything else as JSON.
 * Shape-based rather than name-based, so a new tool returning a known shape draws right away.
 */
export function ResultView({ tool, structured, text }: { tool: string; structured?: unknown; text: string }) {
  const s = structured as Record<string, unknown> | undefined
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    if (isAdcCapture(s)) return <AdcEnvelope capture={s} />
    if (isLaCapture(s)) return <LaSummary capture={s} />
    if (isAdcCapture(s.adc) && isLaCapture(s.la)) {
      return (
        <Stack gap="xs">
          <AdcEnvelope capture={s.adc} />
          <LaSummary capture={s.la} />
        </Stack>
      )
    }
    if (typeof s.text === 'string' && /uart|capture|power_cycle/.test(tool)) {
      return <TerminalText text={s.text} />
    }
    if (Array.isArray(s.items) && typeof s.protocol === 'string') {
      return (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {String(s.protocol)}: {fmt(s.count)} items{s.truncated ? ' (truncated)' : ''}
          </Text>
          <TerminalText text={(s.text as string) || (s.items as string[]).join('\n')} maxHeight={220} />
        </Stack>
      )
    }
    if (isFlat(s)) {
      return (
        <Table fz="xs" verticalSpacing={1} ff="monospace" withRowBorders={false}>
          <Table.Tbody>
            {Object.entries(s).map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td c="dimmed" style={{ width: 1, whiteSpace: 'nowrap', paddingLeft: 0 }}>
                  {k}
                </Table.Td>
                <Table.Td>{fmt(v)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )
    }
    return (
      <Code block style={{ fontSize: 11, maxHeight: 280, overflow: 'auto' }}>
        {JSON.stringify(s, null, 2)}
      </Code>
    )
  }
  return (
    <Code block style={{ fontSize: 11, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
      {text}
    </Code>
  )
}
