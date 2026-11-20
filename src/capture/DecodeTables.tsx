import { useState, type ReactNode } from 'react'
import { Badge, Box, Group, SegmentedControl, Switch, Table, Text, Tooltip } from '@mantine/core'

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

/** Extra controls at the end of a decode row (the bus console's Send again); none: no column. */
export type DecodeRowActions = {
  i2c?: (t: DecodeTransaction) => ReactNode
  spi?: (f: SpiFrame, all: SpiFrame[]) => ReactNode
}

/** One USB packet, or a bus event (kind reset, keep_alive, se1). */
export type UsbPacket = {
  index: number
  start_us: number
  end_us: number
  kind: string
  pid?: string
  pid_value?: number
  addr?: number
  endpoint?: number
  frame?: number
  data_hex?: string
  crc?: string
  ok: boolean
  error?: string
}

export type UsbSetup = { name: string; summary: string; direction: string; type: string; recipient: string; w_length: number }

/** A token with its data packet and handshake; repeated NAKs merged into count. */
export type UsbTransaction = {
  index: number
  start_us: number
  end_us: number
  type: string
  addr: number
  endpoint: number
  data_pid?: string
  data_hex?: string
  data_len: number
  handshake?: string
  count: number
  setup?: UsbSetup
  packets: number[]
  ok: boolean
  error?: string
}

/** A control transfer: SETUP, data stage, status stage. */
export type UsbTransfer = {
  index: number
  start_us: number
  end_us: number
  addr: number
  endpoint: number
  request: string
  setup: UsbSetup
  data_hex?: string
  data_len: number
  status: string
  detail?: string
  ok: boolean
}

export type UsbDecode = {
  protocol: 'usb'
  speed: string
  packets: UsbPacket[]
  transactions: UsbTransaction[]
  transfers: UsbTransfer[]
  sof_count: number
  keep_alive_count?: number
  error_count: number
}

export type DecodeResult =
  | { protocol: 'i2c'; transactions: DecodeTransaction[] }
  | { protocol: 'uart'; frames: UartFrame[] }
  | { protocol: 'spi'; frames: SpiFrame[] }
  | UsbDecode

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
export const DECODE_ACCENT: Record<'i2c' | 'uart' | 'spi' | 'usb', string> = {
  i2c: '#1c7ed6',
  uart: '#0ca678',
  spi: '#7048e8',
  usb: '#e8590c',
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
export function I2cTable({
  transactions,
  accent = DECODE_ACCENT.i2c,
  rowAction,
}: {
  transactions: DecodeTransaction[]
  accent?: string
  rowAction?: DecodeRowActions['i2c']
}) {
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
            {rowAction ? <Table.Th style={{ width: 120 }} /> : null}
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
                {rowAction ? <Table.Td>{rowAction(t)}</Table.Td> : null}
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
export function SpiTable({ frames, accent = DECODE_ACCENT.spi, rowAction }: { frames: SpiFrame[]; accent?: string; rowAction?: DecodeRowActions['spi'] }) {
  return (
    <Frame accent={accent} minWidth={400}>
      <Table {...tableProps}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 48 }}>#</Table.Th>
            <Table.Th style={{ width: 110 }}>Time</Table.Th>
            <Table.Th style={{ width: 120 }}>MOSI</Table.Th>
            <Table.Th style={{ width: 120 }}>MISO</Table.Th>
            {rowAction ? <Table.Th style={{ width: 120 }} /> : null}
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
              {rowAction ? <Table.Td>{rowAction(f, frames)}</Table.Td> : null}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Frame>
  )
}

/** Rows a USB table draws at most; a long capture has thousands of packets. */
const USB_MAX_ROWS = 2000

const clipHex = (hex: string | undefined, len: number) => {
  if (!hex) return EMPTY
  const parts = hex.split(' ')
  return parts.length > 16 ? `${parts.slice(0, 16).join(' ')} … (${len} bytes)` : hex
}

function UsbStatus({ ok, label, error }: { ok: boolean; label: string; error?: string }) {
  if (!ok) return <Status ok={false} label="error" tip={error} />
  const color = label === 'STALL' ? 'red' : label === 'NAK' || label === 'none' || label === 'incomplete' ? 'gray' : 'green'
  return (
    <Badge size="sm" variant="light" color={color}>
      {label}
    </Badge>
  )
}

function UsbTransfersTable({ rows }: { rows: UsbTransfer[] }) {
  return (
    <Table {...tableProps}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ width: 48 }}>#</Table.Th>
          <Table.Th style={{ width: 100 }}>Time</Table.Th>
          <Table.Th style={{ width: 56 }}>Addr</Table.Th>
          <Table.Th>Request</Table.Th>
          <Table.Th>Data</Table.Th>
          <Table.Th style={{ width: 110 }}>Status</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((t) => (
          <Table.Tr key={t.index}>
            <Table.Td>{t.index}</Table.Td>
            <Table.Td ff="monospace">{usLabel(t.start_us)}</Table.Td>
            <Table.Td ff="monospace">{t.endpoint ? `${t.addr}.${t.endpoint}` : t.addr}</Table.Td>
            <Table.Td ff="monospace" fw={600}>
              {t.request}
            </Table.Td>
            <Table.Td ff="monospace">
              {t.detail ? <Text size="sm">{t.detail}</Text> : null}
              <Text size="xs" c="dimmed" ff="monospace">
                {clipHex(t.data_hex, t.data_len)}
              </Text>
            </Table.Td>
            <Table.Td>
              <UsbStatus ok label={t.status} />
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function UsbTransactionsTable({ rows }: { rows: UsbTransaction[] }) {
  return (
    <Table {...tableProps}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ width: 48 }}>#</Table.Th>
          <Table.Th style={{ width: 100 }}>Time</Table.Th>
          <Table.Th style={{ width: 80 }}>Token</Table.Th>
          <Table.Th style={{ width: 64 }}>Addr.EP</Table.Th>
          <Table.Th>Data</Table.Th>
          <Table.Th style={{ width: 130 }}>Handshake</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((t) => (
          <Table.Tr key={t.index}>
            <Table.Td>{t.index}</Table.Td>
            <Table.Td ff="monospace">{usLabel(t.start_us)}</Table.Td>
            <Table.Td fw={600}>{t.type === 'RESET' ? 'Reset' : t.type}</Table.Td>
            <Table.Td ff="monospace">{t.type === 'RESET' ? EMPTY : `${t.addr}.${t.endpoint}`}</Table.Td>
            <Table.Td ff="monospace">
              {t.type === 'RESET'
                ? usLabel(t.end_us - t.start_us)
                : t.setup
                  ? t.setup.summary
                  : t.data_pid
                    ? `${t.data_pid} [${t.data_len}] ${clipHex(t.data_hex, t.data_len) === EMPTY ? '' : clipHex(t.data_hex, t.data_len)}`
                    : EMPTY}
            </Table.Td>
            <Table.Td>
              {t.type === 'RESET' ? null : (
                <Group gap={4} wrap="nowrap">
                  <UsbStatus ok={t.ok} label={t.handshake || 'none'} error={t.error} />
                  {t.count > 1 ? (
                    <Text size="xs" c="dimmed">
                      ×{t.count}
                    </Text>
                  ) : null}
                </Group>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function usbFields(p: UsbPacket) {
  if (p.kind !== 'packet') return p.kind === 'reset' ? usLabel(p.end_us - p.start_us) : EMPTY
  if (p.frame !== undefined) return `frame ${p.frame}`
  if (p.addr !== undefined) return `${p.addr}.${p.endpoint}`
  return p.data_hex !== undefined ? clipHex(p.data_hex, p.data_hex.split(' ').length) : EMPTY
}

function UsbPacketsTable({ rows }: { rows: UsbPacket[] }) {
  return (
    <Table {...tableProps}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ width: 48 }}>#</Table.Th>
          <Table.Th style={{ width: 100 }}>Time</Table.Th>
          <Table.Th style={{ width: 90 }}>PID</Table.Th>
          <Table.Th>Fields</Table.Th>
          <Table.Th style={{ width: 80 }}>CRC</Table.Th>
          <Table.Th style={{ width: 90 }}>Status</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((p) => (
          <Table.Tr key={p.index}>
            <Table.Td>{p.index}</Table.Td>
            <Table.Td ff="monospace">{usLabel(p.start_us)}</Table.Td>
            <Table.Td ff="monospace" fw={600}>
              {p.kind === 'packet' ? p.pid : p.kind === 'reset' ? 'Reset' : p.kind === 'keep_alive' ? 'Keep-alive' : 'SE1'}
            </Table.Td>
            <Table.Td ff="monospace">{usbFields(p)}</Table.Td>
            <Table.Td ff="monospace">{p.crc ?? EMPTY}</Table.Td>
            <Table.Td>{p.ok ? <Status ok label="OK" /> : <Status ok={false} label="error" tip={p.error} />}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

type UsbLayer = 'transfers' | 'transactions' | 'packets'

/** A USB decode in three layers: control transfers (the enumeration), transactions, packets. */
export function UsbTable({ result, accent = DECODE_ACCENT.usb }: { result: UsbDecode; accent?: string }) {
  const [layer, setLayer] = useState<UsbLayer>(result.transfers.length ? 'transfers' : 'transactions')
  const [sof, setSof] = useState(false)
  const packets = sof ? result.packets : result.packets.filter((p) => p.pid !== 'SOF' && p.kind !== 'keep_alive')
  const count = layer === 'transfers' ? result.transfers.length : layer === 'transactions' ? result.transactions.length : packets.length
  return (
    <Box>
      <Group gap="sm" mb={6} wrap="wrap">
        <SegmentedControl
          size="xs"
          value={layer}
          onChange={(v) => setLayer(v as UsbLayer)}
          data={[
            { value: 'transfers', label: `Transfers ${result.transfers.length}` },
            { value: 'transactions', label: `Transactions ${result.transactions.length}` },
            { value: 'packets', label: `Packets ${result.packets.length}` },
          ]}
        />
        {layer === 'packets' ? <Switch size="xs" label="SOF" checked={sof} onChange={(e) => setSof(e.currentTarget.checked)} /> : null}
        <Text size="xs" c="dimmed">
          {result.speed === 'low' ? 'Low speed' : 'Full speed'} · {result.sof_count} SOF
          {result.error_count ? ` · ${result.error_count} bad packets` : ''}
          {count > USB_MAX_ROWS ? ` · first ${USB_MAX_ROWS} rows` : ''}
        </Text>
      </Group>
      <Frame accent={accent} minWidth={620}>
        {layer === 'transfers' ? (
          <UsbTransfersTable rows={result.transfers.slice(0, USB_MAX_ROWS)} />
        ) : layer === 'transactions' ? (
          <UsbTransactionsTable rows={result.transactions.slice(0, USB_MAX_ROWS)} />
        ) : (
          <UsbPacketsTable rows={packets.slice(0, USB_MAX_ROWS)} />
        )}
      </Frame>
    </Box>
  )
}

/** The decode as the right table. */
export function DecodeTable({ result, actions }: { result: DecodeResult; actions?: DecodeRowActions }) {
  if (result.protocol === 'i2c') return <I2cTable transactions={result.transactions} rowAction={actions?.i2c} />
  if (result.protocol === 'uart') return <UartTable frames={result.frames} />
  if (result.protocol === 'usb') return <UsbTable result={result} />
  return <SpiTable frames={result.frames} rowAction={actions?.spi} />
}

/** The chips a decode puts on the waveform: each value on the LA channel that carried it. */
export function decodeAnnotations(
  result: DecodeResult,
  ch: { sda?: number; rx?: number; mosi?: number; miso?: number; dp?: number },
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
  } else if (result.protocol === 'usb') {
    if (!ch.dp) return out
    for (const p of result.packets) out.push({ ch: ch.dp, startUs: p.start_us, endUs: p.end_us, label: usbChip(p), color: DECODE_ACCENT.usb })
  } else {
    for (const f of result.frames) {
      if (ch.mosi) out.push({ ch: ch.mosi, startUs: f.start_us, endUs: f.end_us, label: f.mosi_hex, color: DECODE_ACCENT.spi })
      if (ch.miso) out.push({ ch: ch.miso, startUs: f.start_us, endUs: f.end_us, label: f.miso_hex, color: DECODE_ACCENT.spi })
    }
  }
  return out
}

/** The waveform chip of a USB packet: its PID, with what matters most for it. */
export function usbChip(p: UsbPacket): string {
  if (p.kind === 'reset') return 'Reset'
  if (p.kind === 'keep_alive') return 'EOP'
  if (p.kind !== 'packet') return 'SE1'
  const err = p.ok ? '' : ' !'
  if (p.frame !== undefined) return `SOF ${p.frame}${err}`
  if (p.addr !== undefined) return `${p.pid} ${p.addr}.${p.endpoint}${err}`
  if (p.data_hex !== undefined) return `${p.pid} [${p.data_hex ? p.data_hex.split(' ').length : 0}]${err}`
  return `${p.pid ?? '?'}${err}`
}
