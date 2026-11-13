import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Divider, Group, Paper, Stack, Tabs, Text } from '@mantine/core'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'
import { CaptureView, type FetchCapture } from '../capture/CaptureView'
import { PinStrip } from './PinStrip'
import { I2cTab } from './I2cTab'
import { GpioTab } from './GpioTab'
import { SpiTab } from './SpiTab'
import { CanTab } from './CanTab'
import { TransactionLog } from './TransactionLog'
import { SequencesPanel } from './sequences/SequencesPanel'
import { stepsFromRows, toolProto, type SequenceStore } from './sequences/model'
import { logRow, loggedCall, type BusLogRow, type BusProto } from './busLog'
import { captureArgs, type SendCapture, type SendResult } from './sendCapture'
import { i2cSendAgain, spiBursts, type SendAgain, type SendAgainRequest } from './sendAgain'
import type { DecodeRowActions, SpiFrame } from '../capture/DecodeTables'

// The bus console: one page to listen to and drive the DUT's buses. The capture controls and
// the trace on top (CaptureView), the 14 LA pins in one row, and a dock with a tab per bus plus
// one transaction log for all of them. Every call goes through the host's BenchCall, so its
// policy (the confirmations) applies.

type Wiring = { pins?: { la: number; wired_to?: string | null }[] }

const MAX_ROWS = 500
const UART_LOGGED = new Set(['uart_open', 'uart_write', 'uart_close'])

export function BusDashboard({
  call,
  fetchCapture,
  refreshKey,
  renderConsole,
  initialTab = 'i2c',
  sequences,
}: {
  call: BenchCall
  fetchCapture: FetchCapture
  /** Changes when the agent may have captured or changed the pins: the trace and pins reload. */
  refreshKey?: unknown
  /** The host's console terminal (ConsoleTerminal) for the Console tab, given a logging BenchCall. */
  renderConsole?: (call: BenchCall) => ReactNode
  initialTab?: string
  /** Where saved sequences are kept (embeddedci.com or a local file); without it the log has no selection. */
  sequences?: SequenceStore
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set())
  const [tab, setTab] = useState<string>(initialTab)
  const [rows, setRows] = useState<BusLogRow[]>([])
  const [wiring, setWiring] = useState<Wiring | null>(null)
  const [pinsKey, setPinsKey] = useState(0)
  const nextId = useRef(1)

  useEffect(() => {
    void call('wiring', {}, { poll: true }).then((r) => setWiring(benchData<Wiring>(r) ?? null))
  }, [call, refreshKey])

  const names = useMemo(() => Array.from({ length: 14 }, (_, i) => wiring?.pins?.find((p) => p.la === i + 1)?.wired_to ?? ''), [wiring])
  const wired = (role: string) => wiring?.pins?.find((p) => p.wired_to === role)?.la ?? null

  const add = useCallback((row: Omit<BusLogRow, 'id'>) => {
    const id = nextId.current++
    setRows((old) => [...old.slice(-(MAX_ROWS - 1)), { ...row, id }])
  }, [])
  const calls = useMemo(() => {
    const mk = (p: BusProto, only?: (t: string) => boolean) => loggedCall(call, p, add, only)
    return { i2c: mk('I2C'), spi: mk('SPI'), can: mk('CAN'), gpio: mk('GPIO'), uart: mk('UART', (t) => UART_LOGGED.has(t)) }
  }, [call, add])
  const pinsChanged = useCallback(() => setPinsKey((k) => k + 1), [])

  // Send and capture: capture_la with a send, decoded when the bus has a decoder, then the trace
  // above reloads. The log row keeps the capture's seq, so it can point at the trace.
  const [capKey, setCapKey] = useState(0)
  const [traceNote, setTraceNote] = useState<string | null>(null)
  const traceRef = useRef<HTMLDivElement>(null)
  const sendCapture = useCallback(
    (proto: BusProto): SendCapture =>
      async (send, opts = {}) => {
        const args = captureArgs(send, opts.hz)
        const r = await call('capture_la', args)
        const { id: _id, ...row } = logRow(0, Date.now(), proto, 'capture_la', args, r)
        const error = benchError(r)
        const data = benchData<{ send?: SendResult | null }>(r)
        let seq: number | undefined
        if (data) {
          if (opts.decode) await call('decode_la', { ...opts.decode, capture: 'last', max_items: 1 })
          try {
            seq = (await fetchCapture('la')).seq || undefined
          } catch {
            seq = undefined
          }
          setCapKey((k) => k + 1)
          setTraceNote(null)
        }
        add(seq ? { ...row, capture: seq } : row)
        pinsChanged()
        return { error: error ?? data?.send?.error ?? undefined, send: data?.send ?? undefined, declined: r.declined }
      },
    [call, fetchCapture, add, pinsChanged],
  )
  const senders = useMemo(() => ({ i2c: sendCapture('I2C'), spi: sendCapture('SPI'), gpio: sendCapture('GPIO') }), [sendCapture])

  // Send again: a decoded I2C or SPI transaction back into its tab, filled or sent.
  const [again, setAgain] = useState<SendAgainRequest | null>(null)
  const decodeActions = useMemo<DecodeRowActions>(() => {
    const pick = (s: SendAgain, now: boolean) => {
      setTab(s.bus)
      setAgain({ ...s, now })
    }
    const buttons = (s: SendAgain, what: string) => (
      <Group gap={4} wrap="nowrap">
        <Button size="compact-xs" variant="subtle" onClick={() => pick(s, false)} aria-label={`Fill the send box with ${what}`}>
          Fill
        </Button>
        <Button size="compact-xs" variant="light" onClick={() => pick(s, true)} aria-label={`Send ${what} again`}>
          Send again
        </Button>
      </Group>
    )
    const bursts = new WeakMap<SpiFrame[], Map<number, SendAgain>>()
    return {
      i2c: (t) => {
        const s = i2cSendAgain(t)
        return s ? buttons(s, `transaction ${t.id}`) : null
      },
      spi: (f, all) => {
        let b = bursts.get(all)
        if (!b) bursts.set(all, (b = spiBursts(all)))
        const s = b.get(f.index)
        return s ? buttons(s, `the transfer from word ${f.index}`) : null
      },
    }
  }, [])
  const filled = useCallback(() => setAgain(null), [])

  const showCapture = useCallback(
    async (seq: number) => {
      traceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      let now = 0
      try {
        now = (await fetchCapture('la')).seq
      } catch {
        now = 0
      }
      setTraceNote(now === seq ? null : 'A newer capture replaced that one in the trace.')
    },
    [fetchCapture],
  )

  return (
    <Stack gap={0}>
      <div ref={traceRef}>
        <CaptureView call={call} fetchCapture={fetchCapture} refreshKey={`${String(refreshKey ?? '')}-${capKey}`} decodeActions={decodeActions} />
        {traceNote ? (
          <Text size="xs" c="orange" px="sm" pb="xs" data-testid="trace-note">
            {traceNote}
          </Text>
        ) : null}
      </div>
      <Divider />
      <Stack gap="sm" p="sm">
        <PinStrip call={call} names={names} refreshKey={`${pinsKey}-${String(refreshKey ?? '')}`} />
        <Paper withBorder radius="sm">
          <Tabs value={tab} onChange={(v) => v && setTab(v)} keepMounted={false}>
            <Tabs.List px="xs">
              <Tabs.Tab value="console">Console</Tabs.Tab>
              <Tabs.Tab value="i2c">I2C</Tabs.Tab>
              <Tabs.Tab value="spi">SPI</Tabs.Tab>
              <Tabs.Tab value="can">CAN</Tabs.Tab>
              <Tabs.Tab value="gpio">GPIO</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="console">{renderConsole ? <div style={{ height: 360 }}>{renderConsole(calls.uart)}</div> : null}</Tabs.Panel>
            <Tabs.Panel value="i2c">
              <I2cTab call={calls.i2c} wiredSda={wired('i2c_sda')} wiredScl={wired('i2c_scl')} sendCapture={senders.i2c} fill={again?.bus === 'i2c' ? again : null} onFilled={filled} onChange={pinsChanged} />
            </Tabs.Panel>
            <Tabs.Panel value="spi">
              <SpiTab call={calls.spi} wired={{ sck: wired('spi_sclk'), mosi: wired('spi_mosi'), miso: wired('spi_miso'), cs: wired('spi_cs') }} sendCapture={senders.spi} fill={again?.bus === 'spi' ? again : null} onFilled={filled} onChange={pinsChanged} />
            </Tabs.Panel>
            <Tabs.Panel value="can">
              <CanTab call={calls.can} />
            </Tabs.Panel>
            <Tabs.Panel value="gpio">
              <GpioTab call={calls.gpio} names={names} sendCapture={senders.gpio} onChange={pinsChanged} />
            </Tabs.Panel>
          </Tabs>
        </Paper>
        <Stack gap={4}>
          <TransactionLog
            rows={rows}
            onClear={() => {
              setRows([])
              setPicked(new Set())
            }}
            onShowCapture={(seq) => void showCapture(seq)}
            selected={sequences ? picked : undefined}
            onToggle={sequences ? (id) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id]))) : undefined}
          />
          {sequences ? (
            <SequencesPanel
              store={sequences}
              call={(tool, args, opts) => calls[toolProto(tool, args)](tool, args, opts)}
              selected={stepsFromRows(rows, picked)}
              onClearSelection={() => setPicked(new Set())}
              names={names}
            />
          ) : null}
        </Stack>
      </Stack>
    </Stack>
  )
}
