import { useEffect, useState } from 'react'
import { Alert, Button, Divider, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'
import { parseHexBytes } from './I2cTab'
import { fmtSi, spacedHex } from './busLog'

// The pod as SPI master on four LA pins: pins, mode, rate, then one full-duplex transfer per
// Send (CS low for all the bytes). The tool is spi_transfer; it arms the SPI master for the call
// and releases it after. Modes 1 and 2 need gateware v55: on older gateware the pod says so, and
// that text is shown as it is.

type Xfer = { rx_hex: string; hz: number }

export type SpiPins = { sck: string | null; mosi: string | null; miso: string | null; cs: string | null }

const LA = Array.from({ length: 14 }, (_, i) => ({ value: String(i + 1), label: `LA${i + 1}` }))
const MODES = [
  { value: '0', label: '0 (CPOL 0, CPHA 0)' },
  { value: '1', label: '1 (CPOL 0, CPHA 1)' },
  { value: '2', label: '2 (CPOL 1, CPHA 0)' },
  { value: '3', label: '3 (CPOL 1, CPHA 1)' },
]
const RATES = [
  { value: '250000', label: '250 kHz' },
  { value: '500000', label: '500 kHz' },
  { value: '1000000', label: '1 MHz' },
  { value: '2000000', label: '2 MHz' },
  { value: '4000000', label: '4 MHz' },
  { value: '6000000', label: '6 MHz' },
]
/** The most bytes one spi_transfer sends. */
export const SPI_MAX_BYTES = 4096

/** spi_transfer's pin arguments: only the pins picked, the tool takes the wiring's for the rest. */
export function spiPinArgs(p: SpiPins): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of ['sck', 'mosi', 'miso', 'cs'] as const) if (p[k]) out[k] = Number(p[k])
  return out
}

export function SpiTab({
  call,
  wired,
  onChange,
}: {
  call: BenchCall
  /** The wiring's spi_sclk, spi_mosi, spi_miso and spi_cs channels, the default pins. */
  wired?: Partial<Record<keyof SpiPins, number | null>>
  onChange?: () => void
}) {
  const [pins, setPins] = useState<SpiPins>({ sck: null, mosi: null, miso: null, cs: null })
  const [mode, setMode] = useState('0')
  const [hz, setHz] = useState('1000000')
  const [tx, setTx] = useState('')
  const [last, setLast] = useState<{ tx: string; rx: string; hz: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()

  // The wiring arrives after the first render.
  useEffect(() => {
    setPins((p) => ({
      sck: p.sck ?? (wired?.sck ? String(wired.sck) : null),
      mosi: p.mosi ?? (wired?.mosi ? String(wired.mosi) : null),
      miso: p.miso ?? (wired?.miso ? String(wired.miso) : null),
      cs: p.cs ?? (wired?.cs ? String(wired.cs) : null),
    }))
  }, [wired?.sck, wired?.mosi, wired?.miso, wired?.cs])

  const bytes = parseHexBytes(tx)
  const n = (bytes?.length ?? 0) / 2
  const txBad = tx.trim() !== '' && (bytes === null || n > SPI_MAX_BYTES)

  const send = async () => {
    if (!bytes) return
    setBusy('send')
    setError(undefined)
    setLast(null)
    try {
      const r = await call('spi_transfer', { tx_hex: bytes, ...spiPinArgs(pins), hz: Number(hz), mode: Number(mode) })
      const e = benchError(r)
      if (e) setError(e)
      const d = benchData<Xfer>(r)
      if (d) setLast({ tx: bytes, rx: d.rx_hex, hz: d.hz })
    } finally {
      setBusy(null)
      onChange?.()
    }
  }

  const pin = (k: keyof SpiPins, label: string) => (
    <Select
      key={k}
      size="xs"
      w={84}
      label={label}
      data={LA}
      value={pins[k]}
      onChange={(v) => setPins((p) => ({ ...p, [k]: v }))}
      placeholder="wiring"
      clearable
      comboboxProps={{ withinPortal: true }}
    />
  )

  return (
    <Stack gap="xs" p="sm">
      <Group gap="xs" align="flex-end" wrap="wrap">
        {pin('sck', 'SCK')}
        {pin('mosi', 'MOSI')}
        {pin('miso', 'MISO')}
        {pin('cs', 'CS')}
        <Select size="xs" w={160} label="Mode" data={MODES} value={mode} onChange={(v) => v && setMode(v)} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
        <Select size="xs" w={96} label="Rate" data={RATES} value={hz} onChange={(v) => v && setHz(v)} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
      </Group>
      <Text size="xs" c="dimmed">
        CS goes low for all the bytes of one send. The pod rounds the rate down to one it can run. Modes 1 and 2 need gateware v55 or later.
      </Text>

      <Divider label="Send" labelPosition="left" />
      <Group gap="xs" align="flex-end" wrap="wrap">
        <TextInput
          size="xs"
          style={{ flex: 1, minWidth: 200 }}
          label="Out (hex)"
          placeholder="e.g. 9f 00 00 00"
          value={tx}
          onChange={(e) => setTx(e.currentTarget.value)}
          error={txBad ? `whole bytes, up to ${SPI_MAX_BYTES}` : undefined}
          ff="monospace"
        />
        <Button size="xs" onClick={() => void send()} loading={busy === 'send'} disabled={!!busy || !bytes || txBad}>
          Send
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        SPI clocks a byte in for every byte out: send 00 for each byte you want to read.
      </Text>
      {last ? (
        <Stack gap={0} data-testid="spi-result">
          <Text size="xs" ff="monospace">
            out {spacedHex(last.tx)}
          </Text>
          <Text size="xs" ff="monospace" c="teal">
            in&nbsp; {spacedHex(last.rx)}
          </Text>
          <Text size="xs" c="dimmed">
            the pod ran SCK at {fmtSi(last.hz, 'Hz')}
          </Text>
        </Stack>
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
