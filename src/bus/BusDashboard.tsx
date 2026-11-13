import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Divider, Paper, Stack, Tabs } from '@mantine/core'
import { benchData, type BenchCall } from '../bench/benchCall'
import { CaptureView, type FetchCapture } from '../capture/CaptureView'
import { PinStrip } from './PinStrip'
import { I2cTab } from './I2cTab'
import { GpioTab } from './GpioTab'
import { TransactionLog } from './TransactionLog'
import { loggedCall, type BusLogRow, type BusProto } from './busLog'

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
}: {
  call: BenchCall
  fetchCapture: FetchCapture
  /** Changes when the agent may have captured or changed the pins: the trace and pins reload. */
  refreshKey?: unknown
  /** The host's console terminal (ConsoleTerminal) for the Console tab, given a logging BenchCall. */
  renderConsole?: (call: BenchCall) => ReactNode
  initialTab?: string
}) {
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
    return { i2c: mk('I2C'), gpio: mk('GPIO'), uart: mk('UART', (t) => UART_LOGGED.has(t)) }
  }, [call, add])
  const pinsChanged = useCallback(() => setPinsKey((k) => k + 1), [])

  return (
    <Stack gap={0}>
      <CaptureView call={call} fetchCapture={fetchCapture} refreshKey={refreshKey} />
      <Divider />
      <Stack gap="sm" p="sm">
        <PinStrip call={call} names={names} refreshKey={`${pinsKey}-${String(refreshKey ?? '')}`} />
        <Paper withBorder radius="sm">
          <Tabs value={tab} onChange={(v) => v && setTab(v)} keepMounted={false}>
            <Tabs.List px="xs">
              <Tabs.Tab value="console">Console</Tabs.Tab>
              <Tabs.Tab value="i2c">I2C</Tabs.Tab>
              <Tabs.Tab value="gpio">GPIO</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="console">{renderConsole ? <div style={{ height: 360 }}>{renderConsole(calls.uart)}</div> : null}</Tabs.Panel>
            <Tabs.Panel value="i2c">
              <I2cTab call={calls.i2c} wiredSda={wired('i2c_sda')} wiredScl={wired('i2c_scl')} onChange={pinsChanged} />
            </Tabs.Panel>
            <Tabs.Panel value="gpio">
              <GpioTab call={calls.gpio} names={names} onChange={pinsChanged} />
            </Tabs.Panel>
          </Tabs>
        </Paper>
        <Stack gap={4}>
          <TransactionLog rows={rows} onClear={() => setRows([])} />
        </Stack>
      </Stack>
    </Stack>
  )
}
