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

/** One Modbus RTU frame (request or response). */
export type ModbusFrame = {
  index: number
  start_us: number
  end_us: number
  role: string
  addr: number
  function: number
  function_name: string
  exception?: string
  start?: number
  quantity?: number
  values?: number[]
  summary: string
  data_hex: string
  crc: string
  reply_to?: number
  response_us?: number
  ok: boolean
  error?: string
}

/** One CAN or CAN FD frame; kind data, remote or error. */
export type CanFrame = {
  index: number
  start_us: number
  end_us: number
  kind: string
  id: number
  id_hex: string
  extended: boolean
  fd: boolean
  brs: boolean
  esi: boolean
  dlc: number
  len: number
  data_hex: string
  crc: string
  ack: boolean
  stuff_bits: number
  ok: boolean
  error?: string
}

export type PwmStat = { min: number; max: number; mean: number }
export type PwmPeriod = { index: number; start_us: number; period_us: number; freq_hz: number; high_us: number; low_us: number; duty: number }
/** One measured channel: a summary, then one row per period. */
export type PwmChannel = {
  channel: number
  count: number
  level?: number
  freq_hz: PwmStat
  period_us: PwmStat
  duty: PwmStat
  high_us: PwmStat
  low_us: PwmStat
  jitter_us: number
  glitches: number
  servo?: { pulse_ms: PwmStat; position_pct: PwmStat }
  periods: PwmPeriod[]
  truncated: boolean
}

/** Everything from one 1-Wire reset to the next. */
export type OneWireTransaction = {
  index: number
  start_us: number
  end_us: number
  reset: boolean
  presence: boolean
  overdrive: boolean
  rom_command?: number
  rom_command_name?: string
  rom?: string
  rom_crc_ok?: boolean
  function?: string
  bytes_hex: string
  detail?: string
  ok: boolean
  error?: string
}

/** One SMBus or PMBus transaction. */
export type SmbusTransaction = {
  index: number
  start_us: number
  end_us: number
  addr: number
  addr_hex: string
  kind: string
  command?: number
  command_name?: string
  data_hex: string
  value?: string
  pec: string
  ok: boolean
  error?: string
}

export type DecodeResult =
  | { protocol: 'i2c'; transactions: DecodeTransaction[] }
  | { protocol: 'uart'; frames: UartFrame[] }
  | { protocol: 'spi'; frames: SpiFrame[] }
  | UsbDecode
  | { protocol: 'modbus'; frames: ModbusFrame[] }
  | { protocol: 'can'; frames: CanFrame[] }
  | { protocol: 'pwm'; channels: PwmChannel[] }
  | { protocol: 'onewire'; transactions: OneWireTransaction[] }
  | { protocol: 'smbus'; transactions: SmbusTransaction[] }
  | { protocol: 'pmbus'; transactions: SmbusTransaction[] }

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
export const DECODE_ACCENT: Record<'i2c' | 'uart' | 'spi' | 'usb' | 'modbus' | 'can' | 'pwm' | 'onewire' | 'smbus' | 'pmbus', string> = {
  i2c: '#1c7ed6',
  uart: '#0ca678',
  spi: '#7048e8',
  usb: '#e8590c',
  modbus: '#2f9e44',
  can: '#c2255c',
  pwm: '#f08c00',
  onewire: '#1098ad',
  smbus: '#4263eb',
  pmbus: '#4263eb',
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

/** Rows a table draws at most. */
const MAX_ROWS = 2000

const fmtNum = (v: number, digits = 4) => (Number.isFinite(v) ? Number(v.toPrecision(digits)).toLocaleString() : EMPTY)

function Rows<T>({ rows, children }: { rows: T[]; children: (rows: T[]) => ReactNode }) {
  return (
    <>
      {children(rows.slice(0, MAX_ROWS))}
      {rows.length > MAX_ROWS ? (
        <Text size="xs" c="dimmed" mt={4}>
          First {MAX_ROWS} of {rows.length} rows.
        </Text>
      ) : null}
    </>
  )
}

/** Modbus RTU frames: request, response, what it read or wrote. */
export function ModbusTable({ frames, accent = DECODE_ACCENT.modbus }: { frames: ModbusFrame[]; accent?: string }) {
  return (
    <Rows rows={frames}>
      {(rows) => (
        <Frame accent={accent} minWidth={620}>
          <Table {...tableProps}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 48 }}>#</Table.Th>
                <Table.Th style={{ width: 100 }}>Time</Table.Th>
                <Table.Th style={{ width: 90 }}>Role</Table.Th>
                <Table.Th style={{ width: 56 }}>Addr</Table.Th>
                <Table.Th>Frame</Table.Th>
                <Table.Th style={{ width: 100 }}>Reply</Table.Th>
                <Table.Th style={{ width: 90 }}>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((f) => (
                <Table.Tr key={f.index}>
                  <Table.Td>{f.index}</Table.Td>
                  <Table.Td ff="monospace">{usLabel(f.start_us)}</Table.Td>
                  <Table.Td>{f.role}</Table.Td>
                  <Table.Td ff="monospace">{f.addr}</Table.Td>
                  <Table.Td ff="monospace" fw={600}>
                    {f.summary}
                  </Table.Td>
                  <Table.Td ff="monospace">{f.reply_to ? `#${f.reply_to} +${usLabel(f.response_us ?? 0)}` : EMPTY}</Table.Td>
                  <Table.Td>{f.ok ? <Status ok label={f.exception ? 'exception' : 'OK'} /> : <Status ok={false} label="error" tip={f.error} />}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Frame>
      )}
    </Rows>
  )
}

/** CAN and CAN FD frames. */
export function CanTable({ frames, accent = DECODE_ACCENT.can }: { frames: CanFrame[]; accent?: string }) {
  return (
    <Rows rows={frames}>
      {(rows) => (
        <Frame accent={accent} minWidth={620}>
          <Table {...tableProps}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 48 }}>#</Table.Th>
                <Table.Th style={{ width: 100 }}>Time</Table.Th>
                <Table.Th style={{ width: 110 }}>ID</Table.Th>
                <Table.Th style={{ width: 90 }}>Type</Table.Th>
                <Table.Th style={{ width: 48 }}>Len</Table.Th>
                <Table.Th>Data</Table.Th>
                <Table.Th style={{ width: 90 }}>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((f) => (
                <Table.Tr key={f.index}>
                  <Table.Td>{f.index}</Table.Td>
                  <Table.Td ff="monospace">{usLabel(f.start_us)}</Table.Td>
                  <Table.Td ff="monospace" fw={600}>
                    {f.id_hex}
                  </Table.Td>
                  <Table.Td>
                    {f.kind === 'data' ? (f.fd ? (f.brs ? 'FD BRS' : 'FD') : f.extended ? 'ext' : 'base') : f.kind}
                  </Table.Td>
                  <Table.Td ff="monospace">{f.kind === 'error' ? EMPTY : f.len}</Table.Td>
                  <Table.Td ff="monospace">{clipHex(f.data_hex, f.len)}</Table.Td>
                  <Table.Td>{f.ok ? <Status ok label="ACK" /> : <Status ok={false} label="error" tip={f.error} />}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Frame>
      )}
    </Rows>
  )
}

/** PWM: a summary per channel, then its periods. */
export function PwmTable({ channels, accent = DECODE_ACCENT.pwm }: { channels: PwmChannel[]; accent?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const shown = channels.find((c) => c.channel === open)
  return (
    <Box>
      <Frame accent={accent} minWidth={620}>
        <Table {...tableProps}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 64 }}>Channel</Table.Th>
              <Table.Th>Frequency</Table.Th>
              <Table.Th>Duty</Table.Th>
              <Table.Th>High</Table.Th>
              <Table.Th style={{ width: 90 }}>Jitter</Table.Th>
              <Table.Th style={{ width: 90 }}>Periods</Table.Th>
              <Table.Th>Servo</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {channels.map((c) => (
              <Table.Tr key={c.channel} onClick={() => setOpen(c.count ? c.channel : null)} style={{ cursor: c.count ? 'pointer' : undefined }}>
                <Table.Td fw={600}>LA{c.channel}</Table.Td>
                {c.count ? (
                  <>
                    <Table.Td ff="monospace">
                      {fmtNum(c.freq_hz.mean)} Hz{' '}
                      <Text span c="dimmed" size="xs">
                        ({fmtNum(c.freq_hz.min)}-{fmtNum(c.freq_hz.max)})
                      </Text>
                    </Table.Td>
                    <Table.Td ff="monospace">
                      {(100 * c.duty.mean).toFixed(2)} %{' '}
                      <Text span c="dimmed" size="xs">
                        ({(100 * c.duty.min).toFixed(1)}-{(100 * c.duty.max).toFixed(1)})
                      </Text>
                    </Table.Td>
                    <Table.Td ff="monospace">{usLabel(c.high_us.mean)}</Table.Td>
                    <Table.Td ff="monospace">{usLabel(c.jitter_us)}</Table.Td>
                    <Table.Td ff="monospace">
                      {c.count}
                      {c.glitches ? (
                        <Text span c="orange" size="xs">
                          {' '}
                          {c.glitches} glitches
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td ff="monospace">{c.servo ? `${c.servo.pulse_ms.mean.toFixed(3)} ms, ${c.servo.position_pct.mean.toFixed(1)} %` : EMPTY}</Table.Td>
                  </>
                ) : (
                  <Table.Td colSpan={6} c="dimmed">
                    No full period (line {c.level === 1 ? 'high' : 'low'})
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Frame>
      {shown ? (
        <Box mt="xs">
          <Rows rows={shown.periods}>
            {(rows) => (
              <Frame accent={accent} minWidth={520}>
                <Table {...tableProps}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 56 }}>#</Table.Th>
                      <Table.Th>Time</Table.Th>
                      <Table.Th>Period</Table.Th>
                      <Table.Th>Frequency</Table.Th>
                      <Table.Th>High</Table.Th>
                      <Table.Th>Duty</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((p) => (
                      <Table.Tr key={p.index}>
                        <Table.Td>{p.index}</Table.Td>
                        <Table.Td ff="monospace">{usLabel(p.start_us)}</Table.Td>
                        <Table.Td ff="monospace">{usLabel(p.period_us)}</Table.Td>
                        <Table.Td ff="monospace">{fmtNum(p.freq_hz)} Hz</Table.Td>
                        <Table.Td ff="monospace">{usLabel(p.high_us)}</Table.Td>
                        <Table.Td ff="monospace">{(100 * p.duty).toFixed(2)} %</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Frame>
            )}
          </Rows>
        </Box>
      ) : null}
    </Box>
  )
}

/** 1-Wire transactions: reset, ROM step, function. */
export function OneWireTable({ transactions, accent = DECODE_ACCENT.onewire }: { transactions: OneWireTransaction[]; accent?: string }) {
  return (
    <Rows rows={transactions}>
      {(rows) => (
        <Frame accent={accent} minWidth={620}>
          <Table {...tableProps}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 48 }}>#</Table.Th>
                <Table.Th style={{ width: 100 }}>Time</Table.Th>
                <Table.Th style={{ width: 150 }}>ROM</Table.Th>
                <Table.Th>Device</Table.Th>
                <Table.Th>Function</Table.Th>
                <Table.Th style={{ width: 90 }}>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((t) => (
                <Table.Tr key={t.index}>
                  <Table.Td>{t.index}</Table.Td>
                  <Table.Td ff="monospace">{usLabel(t.start_us)}</Table.Td>
                  <Table.Td fw={600}>
                    {t.rom_command_name ?? (t.reset ? 'reset' : EMPTY)}
                    {t.overdrive ? (
                      <Text span c="dimmed" size="xs">
                        {' '}
                        OD
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td ff="monospace">{t.rom ?? EMPTY}</Table.Td>
                  <Table.Td ff="monospace">
                    {t.function ? `${t.function}${t.detail ? `: ${t.detail}` : ''}` : EMPTY}
                    {t.bytes_hex ? (
                      <Text size="xs" c="dimmed" ff="monospace">
                        {clipHex(t.bytes_hex, t.bytes_hex.split(' ').length)}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    {t.ok ? <Status ok label={t.reset ? 'presence' : 'OK'} /> : <Status ok={false} label="error" tip={t.error} />}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Frame>
      )}
    </Rows>
  )
}

/** SMBus / PMBus transactions: protocol, command, value, PEC. */
export function SmbusTable({ transactions, accent = DECODE_ACCENT.smbus }: { transactions: SmbusTransaction[]; accent?: string }) {
  return (
    <Rows rows={transactions}>
      {(rows) => (
        <Frame accent={accent} minWidth={620}>
          <Table {...tableProps}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 48 }}>#</Table.Th>
                <Table.Th style={{ width: 100 }}>Time</Table.Th>
                <Table.Th style={{ width: 64 }}>Addr</Table.Th>
                <Table.Th style={{ width: 120 }}>Protocol</Table.Th>
                <Table.Th>Command</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th style={{ width: 90 }}>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((t) => (
                <Table.Tr key={t.index}>
                  <Table.Td>{t.index}</Table.Td>
                  <Table.Td ff="monospace">{usLabel(t.start_us)}</Table.Td>
                  <Table.Td ff="monospace" fw={600}>
                    {t.addr_hex}
                  </Table.Td>
                  <Table.Td>{t.kind}</Table.Td>
                  <Table.Td ff="monospace">
                    {t.command_name ?? (t.command !== undefined ? `0x${t.command.toString(16).toUpperCase().padStart(2, '0')}` : EMPTY)}
                  </Table.Td>
                  <Table.Td ff="monospace">
                    {t.value ?? (t.data_hex || EMPTY)}
                    {t.value && t.data_hex ? (
                      <Text span c="dimmed" size="xs">
                        {' '}
                        ({t.data_hex})
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    {t.ok ? <Status ok label={t.pec === 'ok' ? 'PEC OK' : 'ACK'} /> : <Status ok={false} label="error" tip={t.error} />}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Frame>
      )}
    </Rows>
  )
}

/** The decode as the right table. */
export function DecodeTable({ result, actions }: { result: DecodeResult; actions?: DecodeRowActions }) {
  if (result.protocol === 'i2c') return <I2cTable transactions={result.transactions} rowAction={actions?.i2c} />
  if (result.protocol === 'uart') return <UartTable frames={result.frames} />
  if (result.protocol === 'usb') return <UsbTable result={result} />
  if (result.protocol === 'modbus') return <ModbusTable frames={result.frames} />
  if (result.protocol === 'can') return <CanTable frames={result.frames} />
  if (result.protocol === 'pwm') return <PwmTable channels={result.channels} />
  if (result.protocol === 'onewire') return <OneWireTable transactions={result.transactions} />
  if (result.protocol === 'smbus' || result.protocol === 'pmbus') return <SmbusTable transactions={result.transactions} accent={DECODE_ACCENT[result.protocol]} />
  return <SpiTable frames={result.frames} rowAction={actions?.spi} />
}

/** The chips a decode puts on the waveform: each value on the LA channel that carried it. */
export function decodeAnnotations(
  result: DecodeResult,
  ch: { sda?: number; rx?: number; mosi?: number; miso?: number; dp?: number; can?: number; onewire?: number },
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
  } else if (result.protocol === 'modbus') {
    if (!ch.rx) return out
    for (const f of result.frames) out.push({ ch: ch.rx, startUs: f.start_us, endUs: f.end_us, label: `${f.addr} ${f.function_name}${f.ok ? '' : ' !'}`, color: DECODE_ACCENT.modbus })
  } else if (result.protocol === 'can') {
    if (!ch.can) return out
    for (const f of result.frames) out.push({ ch: ch.can, startUs: f.start_us, endUs: f.end_us, label: f.kind === 'error' ? 'error frame' : `${f.id_hex} [${f.len}]${f.ok ? '' : ' !'}`, color: DECODE_ACCENT.can })
  } else if (result.protocol === 'onewire') {
    if (!ch.onewire) return out
    for (const t of result.transactions) out.push({ ch: ch.onewire, startUs: t.start_us, endUs: t.end_us, label: [t.rom_command_name, t.function].filter(Boolean).join(' ') || 'reset', color: DECODE_ACCENT.onewire })
  } else if (result.protocol === 'smbus' || result.protocol === 'pmbus') {
    if (!ch.sda) return out
    for (const t of result.transactions) out.push({ ch: ch.sda, startUs: t.start_us, endUs: t.end_us, label: t.command_name ?? t.kind, color: DECODE_ACCENT[result.protocol] })
  } else if (result.protocol === 'pwm') {
    return out
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
