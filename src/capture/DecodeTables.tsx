import { Badge, Box, Table, Text, Tooltip } from '@mantine/core'

// Decode results as tables, shared by the web app's Capture tab and the desktop app. The shapes
// are what the EmbeddedCI server's /analyzer/decode and the BenchPod MCP server's
// benchpod://capture/decode resource both return.

export type DecodeSegment = {
  type: string
  start_us: number
  end_us: number
  value?: string
  ack?: boolean
  error?: string
}

/** One I2C transaction: everything between a START and its STOP. */
export type DecodeTransaction = {
  id: number
  direction: string
  address: string
  start_us: number
  end_us: number
  ok: boolean
  segments: DecodeSegment[]
  register?: string
  error_kind?: string
  error?: string
}

export type UartFrame = { index: number; start_us: number; end_us: number; value: number; hex: string; text: string; ok: boolean; error?: string }
export type SpiFrame = { index: number; start_us: number; end_us: number; mosi: number; miso: number; mosi_hex: string; miso_hex: string }

export type DecodeResult =
  | { protocol: 'i2c'; transactions: DecodeTransaction[] }
  | { protocol: 'uart'; frames: UartFrame[] }
  | { protocol: 'spi'; frames: SpiFrame[] }

const EMPTY = '—'

const tableProps = {
  striped: true,
  withTableBorder: true,
  withColumnBorders: true,
  highlightOnHover: true,
  verticalSpacing: 'xs',
  fz: 'sm',
} as const

const usLabel = (us: number) => (us < 1000 ? `${us.toFixed(1)} µs` : `${(us / 1000).toFixed(3)} ms`)

/** Per-protocol accent, shared by the waveform chips and the table's left border. */
export const DECODE_ACCENT: Record<'i2c' | 'uart' | 'spi', string> = {
  i2c: '#1c7ed6',
  uart: '#0ca678',
  spi: '#7048e8',
}

function Frame({ accent, minWidth, children }: { accent: string; minWidth: number; children: React.ReactNode }) {
  return (
    <Box style={{ borderLeft: `3px solid ${accent}`, borderRadius: 4 }}>
      <Table.ScrollContainer minWidth={minWidth}>{children}</Table.ScrollContainer>
    </Box>
  )
}

function Status({ ok, label, tip }: { ok: boolean; label: string; tip?: string }) {
  const b = (
    <Badge size="sm" variant="light" color={ok ? 'green' : 'red'}>
      {label}
    </Badge>
  )
  return tip ? <Tooltip label={tip}>{b}</Tooltip> : b
}

/** One decoded I2C transaction per row (address / direction / register / data / status). */
export function I2cTable({ transactions, accent = DECODE_ACCENT.i2c }: { transactions: DecodeTransaction[]; accent?: string }) {
  return (
    <Frame accent={accent} minWidth={560}>
      <Table {...tableProps}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 48 }}>#</Table.Th>
            <Table.Th style={{ width: 90 }}>Address</Table.Th>
            <Table.Th style={{ width: 90 }}>Dir</Table.Th>
            <Table.Th style={{ width: 90 }}>Register</Table.Th>
            <Table.Th>Data</Table.Th>
            <Table.Th style={{ width: 120 }}>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {transactions.map((t) => {
            const data = t.segments
              .filter((s) => s.type.startsWith('data'))
              .map((s) => s.value)
              .filter(Boolean)
              .join(' ')
            return (
              <Table.Tr key={t.id}>
                <Table.Td>{t.id}</Table.Td>
                <Table.Td ff="monospace" fw={600}>
                  {t.address}
                </Table.Td>
                <Table.Td>{t.direction}</Table.Td>
                <Table.Td ff="monospace">{t.register ?? EMPTY}</Table.Td>
                <Table.Td ff="monospace">{data || EMPTY}</Table.Td>
                <Table.Td>{t.ok ? <Status ok label="ACK" /> : <Status ok={false} label={t.error_kind ?? 'ERR'} tip={t.error ?? t.error_kind} />}</Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Frame>
  )
}

/** One decoded UART byte per row (time / hex / decimal / ASCII / status). */
export function UartTable({ frames, accent = DECODE_ACCENT.uart }: { frames: UartFrame[]; accent?: string }) {
  return (
    <Frame accent={accent} minWidth={520}>
      <Table {...tableProps}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 48 }}>#</Table.Th>
            <Table.Th style={{ width: 110 }}>Time</Table.Th>
            <Table.Th style={{ width: 90 }}>Hex</Table.Th>
            <Table.Th style={{ width: 80 }}>Dec</Table.Th>
            <Table.Th style={{ width: 70 }}>ASCII</Table.Th>
            <Table.Th style={{ width: 120 }}>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {frames.map((f) => (
            <Table.Tr key={f.index}>
              <Table.Td>{f.index}</Table.Td>
              <Table.Td ff="monospace">{usLabel(f.start_us)}</Table.Td>
              <Table.Td ff="monospace" fw={600}>
                {f.hex}
              </Table.Td>
              <Table.Td ff="monospace">{f.value}</Table.Td>
              <Table.Td ff="monospace">{f.text ? `'${f.text}'` : '·'}</Table.Td>
              <Table.Td>{f.ok ? <Status ok label="OK" /> : <Status ok={false} label={f.error || 'error'} />}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Frame>
  )
}

/** One decoded SPI word per row (time / MOSI / MISO, clocked together). */
export function SpiTable({ frames, accent = DECODE_ACCENT.spi }: { frames: SpiFrame[]; accent?: string }) {
  return (
    <Frame accent={accent} minWidth={400}>
      <Table {...tableProps}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 48 }}>#</Table.Th>
            <Table.Th style={{ width: 110 }}>Time</Table.Th>
            <Table.Th style={{ width: 120 }}>MOSI</Table.Th>
            <Table.Th style={{ width: 120 }}>MISO</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {frames.map((f) => (
            <Table.Tr key={f.index}>
              <Table.Td>{f.index}</Table.Td>
              <Table.Td ff="monospace">{usLabel(f.start_us)}</Table.Td>
              <Table.Td ff="monospace" fw={600}>
                {f.mosi_hex}{' '}
                <Text span c="dimmed" fw={400}>
                  ({f.mosi})
                </Text>
              </Table.Td>
              <Table.Td ff="monospace" fw={600}>
                {f.miso_hex}{' '}
                <Text span c="dimmed" fw={400}>
                  ({f.miso})
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Frame>
  )
}

/** The decode as the right table. */
export function DecodeTable({ result }: { result: DecodeResult }) {
  if (result.protocol === 'i2c') return <I2cTable transactions={result.transactions} />
  if (result.protocol === 'uart') return <UartTable frames={result.frames} />
  return <SpiTable frames={result.frames} />
}

/** The chips a decode puts on the waveform: each value on the LA channel that carried it. */
export function decodeAnnotations(
  result: DecodeResult,
  ch: { sda?: number; rx?: number; mosi?: number; miso?: number },
): { ch: number; startUs: number; endUs: number; label: string; color: string }[] {
  const out: { ch: number; startUs: number; endUs: number; label: string; color: string }[] = []
  if (result.protocol === 'i2c') {
    if (!ch.sda) return out
    for (const t of result.transactions)
      for (const s of t.segments)
        if (s.value && (s.type.startsWith('address') || s.type.startsWith('data')))
          out.push({ ch: ch.sda, startUs: s.start_us, endUs: s.end_us, label: s.value, color: DECODE_ACCENT.i2c })
  } else if (result.protocol === 'uart') {
    if (!ch.rx) return out
    for (const f of result.frames) out.push({ ch: ch.rx, startUs: f.start_us, endUs: f.end_us, label: f.text ? `'${f.text}'` : f.hex, color: DECODE_ACCENT.uart })
  } else {
    for (const f of result.frames) {
      if (ch.mosi) out.push({ ch: ch.mosi, startUs: f.start_us, endUs: f.end_us, label: f.mosi_hex, color: DECODE_ACCENT.spi })
      if (ch.miso) out.push({ ch: ch.miso, startUs: f.start_us, endUs: f.end_us, label: f.miso_hex, color: DECODE_ACCENT.spi })
    }
  }
  return out
}
