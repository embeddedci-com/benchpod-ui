import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Alert, Box, Button, Group, NumberInput, ScrollArea, SegmentedControl, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { TerminalText } from '../results/ResultView'
import { benchData, benchError, type BenchCall } from './benchCall'
import { UartLineOptions, entryHex, loadUartLine, saveUartLine, uartLineArgs, type UartLine } from './UartLineOptions'

// The board's console, typed into by hand: the web app's serial terminal for a host's bench panel.
//
// The host keeps one log of everything that crossed the UART, the agent's reads and writes and
// these, because a read hands out each byte once:
//
//   GET  {logBase}?after=<seq>  -> {"entries": [{seq, dir: "out"|"in"|"note", text, source}], "next", "open", "port"}
//   POST {logBase}/clear
//
// While the session is open and the agent is not running, the terminal pulls the board's output
// with uart_read (as a poll); while the agent runs it only shows the log, so it never takes the
// output the agent is waiting for.

/** Data bits, parity (N/E/O), stop bits; anything but 8N1 needs pod firmware 3.10.8+. Blank: the pins profile's. */
const UART_FRAMES = ['8N1', '8E1', '8O1', '8N2', '8E2', '8O2']

export type ConsoleLogEntry = { seq: number; dir: 'out' | 'in' | 'note'; text: string; source?: string }
type LogPage = { entries: ConsoleLogEntry[]; next: number; open: boolean; port?: string }

const LOG_POLL_MS = 300
const READ_TIMEOUT_S = 0.5
const MAX_SHOWN = 400_000

const LA_CHANNELS = Array.from({ length: 14 }, (_, i) => ({ value: String(i + 1), label: `LA${i + 1}` }))

const ENDINGS = [
  { value: 'lf', label: 'LF' },
  { value: 'crlf', label: 'CRLF' },
  { value: 'none', label: 'none' },
]

function render(entries: ConsoleLogEntry[]): string {
  let out = ''
  for (const e of entries) {
    if (e.dir === 'out') out += e.text
    else if (e.dir === 'in') out += `${out.endsWith('\n') || out === '' ? '' : '\n'}⟶ ${e.text}\n`
    else out += `${out.endsWith('\n') || out === '' ? '' : '\n'}── ${e.text} ──\n`
  }
  return out.length > MAX_SHOWN ? out.slice(out.length - MAX_SHOWN) : out
}

export function ConsoleTerminal({
  call,
  logBase,
  agentRunning,
}: {
  call: BenchCall
  /** The host's console log endpoint (e.g. /api/console). */
  logBase: string
  /** The agent is running: show the log, but leave the reading to it. */
  agentRunning: boolean
}) {
  const [entries, setEntries] = useState<ConsoleLogEntry[]>([])
  const [open, setOpen] = useState(false)
  const [port, setPort] = useState('')
  const [line, setLine] = useState('')
  const [ending, setEnding] = useState('lf')
  const [baud, setBaud] = useState<number | ''>('')
  // Data bits, parity and stop bits; null takes the pins profile's (8N1 unless it says otherwise).
  const [frame, setFrame] = useState<string | null>(null)
  // One wire and boot entry (UartLineOptions), remembered on this computer.
  const [uartLine, setUartLineState] = useState<UartLine>(loadUartLine)
  const setUartLine = (v: UartLine) => {
    setUartLineState(v)
    saveUartLine(v)
  }
  const [rx, setRx] = useState<string | null>(null)
  const [tx, setTx] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const next = useRef(0)
  const history = useRef<string[]>([])
  const histPos = useRef(-1)
  const viewport = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // The log: everything the agent and the terminal read and typed.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const r = await fetch(`${logBase}?after=${next.current}`)
        if (r.ok) {
          const p = (await r.json()) as LogPage
          if (!alive) return
          if (p.next < next.current) {
            // the log was cleared or the host restarted: start over
            next.current = 0
            setEntries([])
          } else if (p.entries.length) {
            next.current = p.next
            setEntries((old) => [...old, ...p.entries])
          } else next.current = p.next
          setOpen(p.open)
          setPort(p.port ?? '')
        }
      } catch {
        // the host is restarting: try again
      }
      if (alive) timer = setTimeout(tick, LOG_POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [logBase])

  // Pull the board's output while the session is open and the agent leaves the console alone.
  useEffect(() => {
    if (!open || agentRunning) return
    let alive = true
    const loop = async () => {
      while (alive) {
        const r = await call('uart_read', { timeout_s: READ_TIMEOUT_S }, { poll: true })
        if (r.is_error || r.refused) {
          if (alive) await new Promise((res) => setTimeout(res, 1000))
        }
      }
    }
    void loop()
    return () => {
      alive = false
    }
  }, [open, agentRunning, call])

  // Follow the output unless the reader scrolled up.
  useEffect(() => {
    const v = viewport.current
    if (v && stick.current) v.scrollTop = v.scrollHeight
  }, [entries])

  const run = useCallback(
    async (tool: string, args: Record<string, unknown>) => {
      setBusy(true)
      try {
        const r = await call(tool, args)
        setError(benchError(r))
        return r
      } finally {
        setBusy(false)
      }
    },
    [call],
  )

  const send = async () => {
    if (!open) return
    const text = line
    if (text) {
      history.current = [text, ...history.current.filter((h) => h !== text)].slice(0, 50)
    }
    histPos.current = -1
    setLine('')
    stick.current = true
    await run('uart_write', { text, line_ending: ending })
  }

  const openSession = async () => {
    const args: Record<string, unknown> = {}
    if (baud) args.baud = baud
    if (rx) args.rx = Number(rx)
    if (tx) args.tx = Number(tx)
    if (uartLine.entry && entryHex(uartLine.entry.hex) === null) {
      setError('First bytes: whole hex bytes, at most 32 (e.g. 00 c5)')
      return
    }
    Object.assign(args, uartLineArgs(uartLine))
    // One wire: TX is the RX pin (the MCP defaults tx to rx with half_duplex).
    if (uartLine.halfDuplex) delete args.tx
    if (frame) {
      args.parity = { E: 'even', O: 'odd' }[frame.charAt(1)] ?? 'none'
      args.stop_bits = frame.charAt(2) === '2' ? 2 : 1
    }
    const r = await run('uart_open', args)
    if (benchData(r)) setOpen(true)
  }

  const clear = async () => {
    await fetch(`${logBase}/clear`, { method: 'POST' }).catch(() => undefined)
    setEntries([])
  }

  const text = render(entries)

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between" px="sm" py={6} gap="xs" wrap="nowrap" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        {open ? (
          <Text size="xs" c="dimmed" ff="monospace" truncate>
            {port || 'UART open'}
            {agentRunning ? ' · the agent is reading' : ''}
          </Text>
        ) : (
          <Group gap="xs" wrap="nowrap">
            <Button size="compact-xs" onClick={() => void openSession()} loading={busy}>
              Open UART
            </Button>
            <Select size="xs" w={78} placeholder="RX" aria-label="RX channel (the board's TX)" data={LA_CHANNELS} value={rx} onChange={setRx} clearable />
            <Select size="xs" w={78} placeholder="TX" aria-label="TX channel (the board's RX)" data={LA_CHANNELS} value={uartLine.halfDuplex ? null : tx} onChange={setTx} clearable disabled={uartLine.halfDuplex} />
            <NumberInput
              size="xs"
              w={90}
              placeholder="baud"
              aria-label="Baud rate"
              value={baud}
              onChange={(v) => setBaud(typeof v === 'number' ? v : '')}
              min={300}
              max={3_000_000}
              hideControls
            />
            <Select size="xs" w={84} placeholder="parity" aria-label="Parity and stop bits (blank: the pins profile's)" data={UART_FRAMES} value={frame} onChange={setFrame} clearable />
            <UartLineOptions value={uartLine} onChange={setUartLine} />
          </Group>
        )}
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Clear the console">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => void clear()} aria-label="Clear the console">
              ⌫
            </ActionIcon>
          </Tooltip>
          {open ? (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => void run('uart_close', {})} disabled={busy}>
              Close
            </Button>
          ) : null}
        </Group>
      </Group>
      <ScrollArea
        viewportRef={viewport}
        style={{ flex: 1, minHeight: 0 }}
        onScrollPositionChange={() => {
          const v = viewport.current
          if (v) stick.current = v.scrollHeight - v.scrollTop - v.clientHeight < 40
        }}
      >
        <Box p="sm">
          {text ? (
            <TerminalText text={text} maxHeight={100000} />
          ) : (
            <Text size="sm" c="dimmed">
              {open ? 'Waiting for the board…' : "Open the UART to see and type into the board's console. The agent's console output shows here too."}
            </Text>
          )}
        </Box>
      </ScrollArea>
      {error ? (
        <Alert color="red" variant="light" p="xs" mx="sm" mb={4} withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}
      <Group gap="xs" p="sm" pt={6} wrap="nowrap" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <TextInput
          style={{ flex: 1 }}
          size="xs"
          ff="monospace"
          placeholder={open ? 'Type a command, Enter sends it' : 'Open the UART first'}
          aria-label="Console input"
          disabled={!open}
          value={line}
          onChange={(e) => setLine(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void send()
            } else if (e.key === 'ArrowUp' && history.current.length) {
              e.preventDefault()
              histPos.current = Math.min(histPos.current + 1, history.current.length - 1)
              setLine(history.current[histPos.current])
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              histPos.current = Math.max(histPos.current - 1, -1)
              setLine(histPos.current < 0 ? '' : history.current[histPos.current])
            }
          }}
        />
        <SegmentedControl size="xs" data={ENDINGS} value={ending} onChange={setEnding} aria-label="Line ending" />
      </Group>
    </Stack>
  )
}
