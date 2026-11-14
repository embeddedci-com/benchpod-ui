import { useEffect, useState } from 'react'
import { Alert, Button, Group, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'
import { hex2, nackWhere, spacedHex } from './busLog'
import { decodeValue, encodeValue, i2cRegHex, parseDevice, spiReadHex, spiReadValue, spiWriteHex, type DeviceDef, type DeviceReg } from './device'

// Device mode in the I2C and SPI tabs: pick a sensor definition from the library (sensor_library,
// sensor_show) and read and write the real chip's registers by name. The pod is the master; the
// reads and writes are ordinary i2c_transfer and spi_transfer calls, so they show in the log.

type Entry = { name: string; kind: string; label: string }
type Xfer = { addr: number; ack: boolean; rx_hex?: string; nack_at?: number | null }
type Cell = { hex?: string; error?: string }

/** One SPI transfer on the tab's pins, mode and rate. */
export type SpiTransfer = (txHex: string, opts?: { approved?: boolean }) => Promise<{ rx?: string; error?: string }>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function DeviceRegs({
  bus,
  call,
  spiTransfer,
  onSpiMode,
}: {
  bus: 'i2c' | 'spi'
  /** The tab's logging BenchCall. */
  call: BenchCall
  /** SPI: a transfer on the tab's settings. */
  spiTransfer?: SpiTransfer
  /** SPI: the definition's mode, for the tab to use. */
  onSpiMode?: (mode: number) => void
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [def, setDef] = useState<DeviceDef | null>(null)
  const [addr, setAddr] = useState<string | null>(null)
  const [cells, setCells] = useState<Record<number, Cell>>({})
  const [inputs, setInputs] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()

  // The library list (needs no pod); poll: the host need not log these reads.
  useEffect(() => {
    let live = true
    void call('sensor_library', {}, { poll: true }).then((r) => {
      if (!live) return
      const e = benchError(r)
      if (e) setError(e)
      const d = benchData<{ entries: Entry[] }>(r)
      setEntries((d?.entries ?? []).filter((x) => x.kind === bus))
    })
    return () => {
      live = false
    }
  }, [call, bus])

  const pick = async (n: string | null) => {
    setName(n)
    setDef(null)
    setCells({})
    setInputs({})
    setError(undefined)
    if (!n) return
    setBusy('load')
    try {
      const r = await call('sensor_show', { name: n }, { poll: true })
      const e = benchError(r)
      if (e) return setError(e)
      const d = parseDevice(benchData<{ yaml: string }>(r)?.yaml ?? '')
      if (typeof d === 'string') return setError(d)
      setDef(d)
      if (d.i2c) setAddr(String(d.i2c.address))
      if (d.spi) onSpiMode?.(d.spi.mode)
    } finally {
      setBusy(null)
    }
  }

  const i2c = async (write: string, read: number, approved = false): Promise<Cell & { ack?: boolean }> => {
    const a = Number(addr)
    const r = await call('i2c_transfer', { addr: a, write_hex: write, read }, { approved })
    const e = benchError(r)
    if (e) return { error: e }
    if (r.declined) return { error: 'not run' }
    const d = benchData<Xfer>(r)
    if (!d) return { error: 'no answer' }
    return d.ack ? { hex: d.rx_hex ?? '', ack: true } : { error: nackWhere(d.nack_at, write.length / 2), ack: false }
  }

  /** approved: the user said yes to the whole batch, so this read asks nothing of its own. */
  const readReg = async (d: DeviceDef, reg: DeviceReg, approved = false): Promise<Cell> => {
    if (d.kind === 'spi') {
      if (!spiTransfer) return { error: 'no SPI' }
      const o = await spiTransfer(spiReadHex(d, reg), { approved })
      return o.error ? { error: o.error } : { hex: spiReadValue(d, o.rx ?? '') }
    }
    if (reg.command) {
      // Write the command alone, give the part its time, then read the answer.
      const w = await i2c(i2cRegHex(d, reg), 0, approved)
      if (w.error || !reg.size) return w.error ? w : { hex: '' }
      await sleep(Math.ceil(reg.command.busyUs / 1000))
      return i2c('', reg.size, true)
    }
    return i2c(i2cRegHex(d, reg), reg.size, approved)
  }

  const read = async (reg: DeviceReg) => {
    if (!def) return
    setBusy(`r${reg.id}`)
    try {
      const c = await readReg(def, reg)
      setCells((o) => ({ ...o, [reg.id]: c }))
    } finally {
      setBusy(null)
    }
  }

  const readAll = async () => {
    if (!def) return
    setBusy('all')
    try {
      // One yes for the batch: the first read asks (if the host wants a yes), the rest go as approved.
      let approved = false
      for (const reg of def.regs) {
        if (reg.command) continue
        const c = await readReg(def, reg, approved)
        setCells((o) => ({ ...o, [reg.id]: c }))
        if (c.error === 'not run') break
        approved = true
      }
    } finally {
      setBusy(null)
    }
  }

  const write = async (reg: DeviceReg) => {
    if (!def) return
    const v = encodeValue(reg, inputs[reg.id] ?? '')
    if ('error' in v) return setCells((o) => ({ ...o, [reg.id]: { error: v.error } }))
    setBusy(`w${reg.id}`)
    try {
      let c: Cell
      if (def.kind === 'spi') {
        const o = spiTransfer ? await spiTransfer(spiWriteHex(def, reg, v.hex)) : { error: 'no SPI' }
        c = o.error ? { error: o.error } : { hex: v.hex }
      } else {
        const w = await i2c(i2cRegHex(def, reg) + v.hex, 0)
        c = w.error ? w : { hex: v.hex }
      }
      setCells((o) => ({ ...o, [reg.id]: c }))
    } finally {
      setBusy(null)
    }
  }

  const addrs = def?.i2c ? [def.i2c.address, ...def.i2c.alt].map((a) => ({ value: String(a), label: hex2(a) })) : []
  const regLabel = (r: DeviceReg) => (def?.i2c?.addressBytes === 2 || r.at > 0xff ? `0x${r.at.toString(16).padStart(4, '0')}` : hex2(r.at))

  return (
    <Stack gap="xs">
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select
          size="xs"
          w={300}
          label="Definition" aria-label="Definition"
          placeholder={entries === null ? 'loading the library' : entries.length ? 'pick a part' : 'none for this bus'}
          data={(entries ?? []).map((e) => ({ value: e.name, label: e.label || e.name }))}
          value={name}
          onChange={(v) => void pick(v)}
          clearable
          comboboxProps={{ withinPortal: true }}
        />
        {def?.i2c ? <Select size="xs" w={84} label="Address" aria-label="Address" data={addrs} value={addr} onChange={(v) => v && setAddr(v)} allowDeselect={false} comboboxProps={{ withinPortal: true }} /> : null}
        {def ? (
          <Button size="xs" variant="light" onClick={() => void readAll()} loading={busy === 'all'} disabled={!!busy || !def.regs.some((r) => !r.command)}>
            Read all
          </Button>
        ) : null}
      </Group>
      <Text size="xs" c="dimmed">
        The pod is the master and your chip the target. {bus === 'i2c' ? 'Open the I2C session first.' : 'The definition sets the SPI mode above.'} Values are decoded by
        the register&apos;s type.
      </Text>
      {def ? (
        <ScrollArea.Autosize mah={300}>
          <Table striped withTableBorder fz="xs" verticalSpacing={2} horizontalSpacing={6} data-testid="device-regs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Register</Table.Th>
                <Table.Th w={64}>At</Table.Th>
                <Table.Th w={56}>Type</Table.Th>
                <Table.Th>Bytes</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th w={260} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {def.regs.map((r) => {
                const c = cells[r.id]
                return (
                  <Table.Tr key={r.id} data-testid={`reg-${r.name}`}>
                    <Table.Td fw={600}>{r.name}</Table.Td>
                    <Table.Td ff="monospace">{regLabel(r)}</Table.Td>
                    <Table.Td ff="monospace" c="dimmed">
                      {r.command ? `${r.size} B` : r.type}
                    </Table.Td>
                    <Table.Td ff="monospace">{c?.hex !== undefined ? spacedHex(c.hex) : ''}</Table.Td>
                    <Table.Td ff="monospace" c={c?.error ? 'orange' : undefined}>
                      {c?.error ?? (c?.hex ? decodeValue(r, c.hex) : '')}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Button size="compact-xs" variant="light" onClick={() => void read(r)} loading={busy === `r${r.id}`} disabled={!!busy} aria-label={`Read ${r.name}`}>
                          {r.command ? 'Run' : 'Read'}
                        </Button>
                        {r.writable ? (
                          <>
                            <TextInput
                              size="xs"
                              w={110}
                              placeholder={r.type === 'bytes' ? 'hex' : r.type === 'text' ? 'text' : 'e.g. 0x10'}
                              value={inputs[r.id] ?? ''}
                              onChange={(e) => {
                                const v = e.currentTarget.value
                                setInputs((o) => ({ ...o, [r.id]: v }))
                              }}
                              aria-label={`New value for ${r.name}`}
                              ff="monospace"
                            />
                            <Button size="compact-xs" variant="subtle" onClick={() => void write(r)} loading={busy === `w${r.id}`} disabled={!!busy || !(inputs[r.id] ?? '').trim()} aria-label={`Write ${r.name}`}>
                              Write
                            </Button>
                          </>
                        ) : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
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
