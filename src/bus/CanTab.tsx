import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Divider, Group, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'
import { parseHexBytes } from './I2cTab'
import { fmtSi } from './busLog'

// The pod's CAN port: open it (bit rate, mode, termination, CAN FD data rate), send a frame, read
// what came in, check the link, close. The tools are can_open, can_write, can_read, can_status
// and can_close. Frames read land in the log, one row each; "Keep reading" polls can_read.

type Session = { open: boolean; bitrate?: number; mode?: string; term?: boolean; data_bitrate?: number | null; fd?: boolean }

const BITRATES = ['125000', '250000', '500000', '1000000'].map((v) => ({ value: v, label: fmtSi(Number(v), 'bit/s') }))
const DATA_RATES = [{ value: '', label: 'Classic CAN' }, ...['1000000', '2000000', '4000000', '5000000', '8000000'].map((v) => ({ value: v, label: `FD ${fmtSi(Number(v), 'bit/s')}` }))]
const MODES = [
  { value: 'normal', label: 'On the bus' },
  { value: 'listen', label: 'Listen only' },
  { value: 'internal', label: 'Loopback, inside' },
  { value: 'external', label: 'Loopback, on the pins' },
]
/** How often "Keep reading" asks for new frames. */
export const CAN_POLL_MS = 500

/** "0x123", "123h" or "291" as a CAN id; NaN when it is not one or does not fit (11 bits, or 29 with ext). */
export function parseCanId(s: string, ext: boolean): number {
  const t = s.trim().toLowerCase()
  let n = NaN
  if (/^0x[0-9a-f]{1,8}$/.test(t)) n = parseInt(t.slice(2), 16)
  else if (/^[0-9a-f]{1,8}h$/.test(t)) n = parseInt(t.slice(0, -1), 16)
  else if (/^\d{1,9}$/.test(t)) n = Number(t)
  return n >= 0 && n <= (ext ? 0x1fffffff : 0x7ff) ? n : NaN
}

/** The data lengths a frame can have: 0-8, and on CAN FD 12, 16, 20, 24, 32, 48 or 64. */
export function canDataOk(len: number, fd: boolean): boolean {
  return len <= 8 || (fd && len <= 64)
}

export function CanTab({ call }: { call: BenchCall }) {
  const [bitrate, setBitrate] = useState('500000')
  const [dataRate, setDataRate] = useState('')
  const [mode, setMode] = useState('normal')
  const [term, setTerm] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [id, setId] = useState('')
  const [data, setData] = useState('')
  const [ext, setExt] = useState(false)
  const [keep, setKeep] = useState(false)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()

  const run = async <T,>(what: string, tool: string, args: Record<string, unknown>, poll = false): Promise<T | undefined> => {
    if (!poll) {
      setBusy(what)
      setError(undefined)
    }
    try {
      const r = await call(tool, args, poll ? { poll: true } : undefined)
      const e = benchError(r)
      if (e) setError(e)
      if (e && poll) setKeep(false)
      return benchData<T>(r)
    } finally {
      if (!poll) setBusy(null)
    }
  }

  const open = async () => {
    const s = await run<Session>('open', 'can_open', { bitrate: Number(bitrate), mode, term, ...(dataRate ? { data_bitrate: Number(dataRate) } : {}) })
    if (s) setSession(s)
  }
  const close = async () => {
    setKeep(false)
    const s = await run<Session>('close', 'can_close', {})
    if (s) setSession(s)
  }
  const check = async () => {
    const s = await run<{ reply: Record<string, unknown> }>('status', 'can_status', {})
    if (s) setStatus(s.reply ?? null)
  }

  // Keep reading: poll can_read; the logging BenchCall puts each frame in the log, even for a poll.
  const polling = useRef(false)
  useEffect(() => {
    if (!keep) return
    const t = setInterval(() => {
      if (polling.current) return
      polling.current = true
      void run('read', 'can_read', { timeout: 0 }, true).finally(() => {
        polling.current = false
      })
    }, CAN_POLL_MS)
    return () => clearInterval(t)
  }, [keep, call])

  const fd = !!session?.fd || !!dataRate
  const canId = parseCanId(id, ext)
  const bytes = parseHexBytes(data)
  const len = (bytes?.length ?? 0) / 2
  const idBad = id.trim() !== '' && Number.isNaN(canId)
  const dataBad = bytes === null || !canDataOk(len, fd)
  const send = async () => {
    if (Number.isNaN(canId) || !bytes) return
    const list = bytes.match(/../g)?.map((h) => parseInt(h, 16)) ?? []
    await run('send', 'can_write', { can_id: canId, data: list, ext })
  }

  const isOpen = !!session?.open
  return (
    <Stack gap="xs" p="sm">
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select size="xs" w={112} label="Bit rate" aria-label="Bit rate" data={BITRATES} value={bitrate} onChange={(v) => v && setBitrate(v)} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
        <Select size="xs" w={128} label="Data phase" aria-label="Data phase" data={DATA_RATES} value={dataRate} onChange={(v) => setDataRate(v ?? '')} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
        <Select size="xs" w={160} label="Mode" aria-label="Mode" data={MODES} value={mode} onChange={(v) => v && setMode(v)} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
        <Switch size="xs" label="120 ohm termination" aria-label="120 ohm termination" checked={term} onChange={(e) => setTerm(e.currentTarget.checked)} mb={6} />
        <Button size="xs" onClick={() => void open()} loading={busy === 'open'} disabled={!!busy}>
          {isOpen ? 'Open again' : 'Open'}
        </Button>
        <Button size="xs" variant="default" onClick={() => void close()} loading={busy === 'close'} disabled={!!busy}>
          Close
        </Button>
        <Button size="xs" variant="light" onClick={() => void check()} loading={busy === 'status'} disabled={!!busy}>
          Status
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Termination: switch it on when the pod is at one end of the bus. CAN FD needs pod firmware 3.10.2 or later.
      </Text>
      {session ? (
        <Text size="xs" ff="monospace" c={isOpen ? 'teal' : 'dimmed'} data-testid="can-session">
          {isOpen
            ? `open: ${fmtSi(session.bitrate ?? 0, 'bit/s')}${session.data_bitrate ? `, data ${fmtSi(session.data_bitrate, 'bit/s')}` : ''}, ${MODES.find((m) => m.value === session.mode)?.label.toLowerCase() ?? session.mode}${session.term ? ', terminated' : ''}`
            : 'closed'}
        </Text>
      ) : null}
      {status ? (
        <Text size="xs" ff="monospace" data-testid="can-status">
          {Object.entries(status)
            .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(', ')}
        </Text>
      ) : null}

      <Divider label="Send a frame" labelPosition="left" />
      <Group gap="xs" align="flex-end" wrap="wrap">
        <TextInput size="xs" w={112} label="ID" aria-label="ID" placeholder="0x123" value={id} onChange={(e) => setId(e.currentTarget.value)} error={idBad ? (ext ? 'up to 0x1fffffff' : 'up to 0x7ff') : undefined} ff="monospace" />
        <Checkbox size="xs" label="Extended (29-bit)" aria-label="Extended (29-bit)" checked={ext} onChange={(e) => setExt(e.currentTarget.checked)} mb={6} />
        <TextInput
          size="xs"
          style={{ flex: 1, minWidth: 160 }}
          label="Data (hex)" aria-label="Data (hex)"
          placeholder="e.g. 01 02 03"
          value={data}
          onChange={(e) => setData(e.currentTarget.value)}
          error={dataBad ? (fd ? 'whole bytes, up to 64' : 'whole bytes, up to 8') : undefined}
          ff="monospace"
        />
        <Button size="xs" onClick={() => void send()} loading={busy === 'send'} disabled={!!busy || Number.isNaN(canId) || dataBad}>
          Send
        </Button>
      </Group>

      <Divider label="Read" labelPosition="left" />
      <Group gap="xs" align="center" wrap="wrap">
        <Button size="xs" variant="light" onClick={() => void run('read', 'can_read', { timeout: 0 })} loading={busy === 'read'} disabled={!!busy}>
          Read
        </Button>
        <Switch size="xs" label="Keep reading" aria-label="Keep reading" checked={keep} onChange={(e) => setKeep(e.currentTarget.checked)} />
        <Text size="xs" c="dimmed">
          Frames the pod received go to the log, one row each.
        </Text>
      </Group>

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
