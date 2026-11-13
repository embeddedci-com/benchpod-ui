import { useEffect, useState } from 'react'
import { Alert, Button, Divider, Group, NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'
import { fmtSi, hex2, nackWhere, spacedHex } from './busLog'

// The pod as I2C master on two LA pins: open a session (pins, speed, pull-ups), send a write, a
// read or both, scan the bus, close. The tools are i2c_open, i2c_transfer, i2c_scan, i2c_close;
// every check (pins, voltage, pull-ups) is the pod's, and its error text is shown as it is.

type Session = { open: boolean; sda?: number; scl?: number; hz?: number; pullups?: string }
type Xfer = { addr: number; ack: boolean; rx_hex?: string; nack_at?: number | null; written?: number }
type Scan = { found: number[]; found_hex?: string[] }

const LA = Array.from({ length: 14 }, (_, i) => ({ value: String(i + 1), label: `LA${i + 1}` }))
const SPEEDS = [
  { value: '100000', label: '100 kHz' },
  { value: '400000', label: '400 kHz' },
  { value: '1000000', label: '1 MHz' },
]

/** "0x48", "48h" or "72" as a 7-bit address; NaN when it is not one. */
export function parseI2cAddr(s: string): number {
  const t = s.trim().toLowerCase()
  let n = NaN
  if (/^0x[0-9a-f]{1,2}$/.test(t)) n = parseInt(t.slice(2), 16)
  else if (/^[0-9a-f]{1,2}h$/.test(t)) n = parseInt(t.slice(0, -1), 16)
  else if (/^\d{1,3}$/.test(t)) n = Number(t)
  return n >= 0 && n <= 127 ? n : NaN
}

/** "01 02 ff", "0102ff" or "0x01 0x02" as plain hex; null when it is not whole bytes. */
export function parseHexBytes(s: string): string | null {
  const t = s.toLowerCase().replace(/0x/g, '').replace(/[\s,]+/g, '')
  return /^([0-9a-f]{2})*$/.test(t) ? t : null
}

export function I2cTab({
  call,
  wiredSda,
  wiredScl,
  onChange,
}: {
  call: BenchCall
  /** The wiring's i2c_sda and i2c_scl channels, the default pins. */
  wiredSda?: number | null
  wiredScl?: number | null
  /** A call ran that may have changed the pins. */
  onChange?: () => void
}) {
  const [sda, setSda] = useState<string | null>(wiredSda ? String(wiredSda) : null)
  const [scl, setScl] = useState<string | null>(wiredScl ? String(wiredScl) : null)
  const [hz, setHz] = useState('100000')
  const [pullups, setPullups] = useState<'pod' | 'external'>('pod')
  const [session, setSession] = useState<Session | null>(null)
  const [addr, setAddr] = useState('')
  const [write, setWrite] = useState('')
  const [read, setRead] = useState<number | ''>(0)
  const [last, setLast] = useState<Xfer | null>(null)
  const [found, setFound] = useState<Scan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()

  // The wiring arrives after the first render.
  useEffect(() => {
    if (wiredSda) setSda((v) => v ?? String(wiredSda))
    if (wiredScl) setScl((v) => v ?? String(wiredScl))
  }, [wiredSda, wiredScl])

  const run = async <T,>(what: string, tool: string, args: Record<string, unknown>): Promise<T | undefined> => {
    setBusy(what)
    setError(undefined)
    try {
      const r = await call(tool, args)
      const e = benchError(r)
      if (e) setError(e)
      return benchData<T>(r)
    } finally {
      setBusy(null)
      onChange?.()
    }
  }

  const pins = () => ({ ...(sda ? { sda: Number(sda) } : {}), ...(scl ? { scl: Number(scl) } : {}) })

  const open = async () => {
    const s = await run<Session>('open', 'i2c_open', { ...pins(), hz: Number(hz), pullups })
    if (s) setSession(s)
  }
  const close = async () => {
    const s = await run<Session>('close', 'i2c_close', {})
    if (s) setSession(s)
  }
  const pull = async (on: boolean) => {
    const las = [sda, scl].filter(Boolean).map(Number)
    await run('pull', 'set_pull', { las, enabled: on })
  }

  const a = parseI2cAddr(addr)
  const w = parseHexBytes(write)
  const n = Number(read) || 0
  const addrBad = addr.trim() !== '' && Number.isNaN(a)
  const writeBad = w === null || (w?.length ?? 0) > 256
  const send = async () => {
    if (Number.isNaN(a) || w === null) return
    setLast(null)
    const r = await run<Xfer>('send', 'i2c_transfer', { addr: a, write_hex: w, read: n })
    if (r) setLast({ ...r, written: w.length / 2 })
  }
  const scan = async () => {
    setFound(null)
    const r = await run<Scan>('scan', 'i2c_scan', {})
    if (r) setFound(r)
  }

  const isOpen = !!session?.open
  return (
    <Stack gap="xs" p="sm">
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select size="xs" w={84} label="SDA" data={LA} value={sda} onChange={setSda} placeholder="wiring" clearable comboboxProps={{ withinPortal: true }} />
        <Select size="xs" w={84} label="SCL" data={LA} value={scl} onChange={setScl} placeholder="wiring" clearable comboboxProps={{ withinPortal: true }} />
        <Select size="xs" w={96} label="Speed" data={SPEEDS} value={hz} onChange={(v) => v && setHz(v)} allowDeselect={false} />
        <Stack gap={2}>
          <Text size="xs" fw={500}>
            Pull-ups
          </Text>
          <SegmentedControl
            size="xs"
            value={pullups}
            onChange={(v) => setPullups(v as 'pod' | 'external')}
            data={[
              { value: 'pod', label: 'Pod' },
              { value: 'external', label: 'On the board' },
            ]}
          />
        </Stack>
        <Button size="xs" onClick={() => void open()} loading={busy === 'open'} disabled={!!busy}>
          {isOpen ? 'Open again' : 'Open'}
        </Button>
        <Button size="xs" variant="default" onClick={() => void close()} loading={busy === 'close'} disabled={!!busy}>
          Close
        </Button>
      </Group>
      {pullups === 'pod' ? (
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            The pod&apos;s pull-ups are on LA1 to LA6 at 3.3 V. Switch them on before you open.
          </Text>
          <Button size="compact-xs" variant="light" onClick={() => void pull(true)} loading={busy === 'pull'} disabled={!!busy || (!sda && !scl)}>
            Switch on
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={() => void pull(false)} disabled={!!busy || (!sda && !scl)}>
            Off
          </Button>
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          The board has its own pull-ups on SDA and SCL.
        </Text>
      )}
      {session ? (
        <Text size="xs" ff="monospace" c={isOpen ? 'teal' : 'dimmed'} data-testid="i2c-session">
          {isOpen
            ? `open: SDA LA${session.sda}, SCL LA${session.scl}${session.hz ? `, the pod runs SCL at ${fmtSi(session.hz, 'Hz')}` : ''}${session.pullups ? `, ${session.pullups === 'pod' ? 'pod' : 'board'} pull-ups` : ''}`
            : 'closed'}
        </Text>
      ) : null}
      {isOpen && session?.hz ? (
        <Text size="xs" c="dimmed">
          A real bus runs a bit slower than this: the rise time adds to each clock. Capture it to see the rate on the wire.
        </Text>
      ) : null}

      <Divider label="Send" labelPosition="left" />
      <Group gap="xs" align="flex-end" wrap="wrap">
        <TextInput size="xs" w={84} label="Address" placeholder="0x48" value={addr} onChange={(e) => setAddr(e.currentTarget.value)} error={addrBad ? '7-bit, e.g. 0x48' : undefined} />
        <TextInput
          size="xs"
          style={{ flex: 1, minWidth: 160 }}
          label="Write (hex)"
          placeholder="e.g. 0f, a register"
          value={write}
          onChange={(e) => setWrite(e.currentTarget.value)}
          error={writeBad ? 'whole bytes, up to 128' : undefined}
          ff="monospace"
        />
        <NumberInput size="xs" w={84} label="Read bytes" value={read} onChange={(v) => setRead(typeof v === 'number' ? v : '')} min={0} max={248} />
        <Button size="xs" onClick={() => void send()} loading={busy === 'send'} disabled={!!busy || Number.isNaN(a) || writeBad}>
          Send
        </Button>
        <Button size="xs" variant="light" onClick={() => void scan()} loading={busy === 'scan'} disabled={!!busy}>
          Scan
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Write only, read only, or a write then a read (a repeated START). Neither: a probe of the address.
      </Text>
      {last ? (
        <Text size="xs" ff="monospace" c={last.ack ? 'teal' : 'orange'} data-testid="i2c-result">
          {hex2(last.addr)} {last.ack ? 'ACK' : nackWhere(last.nack_at, last.written ?? 0)}
          {last.rx_hex ? `: ${spacedHex(last.rx_hex)}` : ''}
        </Text>
      ) : null}
      {found ? (
        <Text size="xs" ff="monospace" data-testid="i2c-scan">
          {found.found.length ? `found ${(found.found_hex ?? found.found.map(hex2)).join(' ')}` : 'no device answered'}
        </Text>
      ) : null}

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}
    </Stack>
  )
}
