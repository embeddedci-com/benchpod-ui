import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Chip, Group, MultiSelect, NumberInput, Select, Stack, Switch, Text } from '@mantine/core'
import { CaptureCanvas, useCanvasColors, type LaEdge } from './CaptureCanvas'
import { DecodeTable, decodeAnnotations, decodeRateNeed, type DecodeResult, type DecodeRowActions } from './DecodeTables'
import { benchData, benchError, type BenchCall } from '../bench/benchCall'
import { fmtSi } from '../results/AdcEnvelope'

// LA and ADC capture by hand, drawn in full with zoom and decode: the web app's Capture tab for a
// host's bench panel. It runs the capture tools (capture_la, capture_adc, capture_correlated,
// decode_la) and draws the last capture from the host's copy of the BenchPod MCP server's
// capture resources (benchpod://capture/la, /adc, /decode), so a capture the agent made shows here
// too.

export type LaCaptureData = {
  seq: number
  correlated?: boolean
  sample_rate_hz: number
  count: number
  pre_samples?: number
  stopped_early?: string
  edges_truncated?: boolean
  edges: [number, number][]
}

export type AdcCaptureData = {
  seq: number
  correlated?: boolean
  sample_rate_hz: number
  count: number
  unit: 'V' | 'mA'
  source?: string | null
  samples_truncated?: boolean
  samples: number[]
}

export type DecodeData = {
  seq: number
  protocol?: string
  /** The decode's channel assignment (a PWM decode: its measured channels). */
  channels?: Record<string, number> | unknown[]
  transactions?: unknown[]
  packets?: unknown[]
  frames?: unknown[]
}

/** Reads the host's copy of a capture resource: the last LA or ADC capture, or the last decode. */
export type FetchCapture = {
  (kind: 'la'): Promise<LaCaptureData>
  (kind: 'adc'): Promise<AdcCaptureData>
  (kind: 'decode'): Promise<DecodeData>
}

type Mode = 'la' | 'adc' | 'both'

const MODES = [
  { value: 'la', label: 'Logic' },
  { value: 'adc', label: 'Analog' },
  { value: 'both', label: 'Both' },
]
const DURATIONS = [
  { value: '0.001', label: '1 ms' },
  { value: '0.01', label: '10 ms' },
  { value: '0.1', label: '100 ms' },
  { value: '0.5', label: '500 ms' },
  { value: '1', label: '1 s' },
  { value: '2', label: '2 s' },
  { value: '5', label: '5 s' },
]
const LA_RATES = [
  { value: '100000', label: '100 kS/s' },
  { value: '1000000', label: '1 MS/s' },
  { value: '4000000', label: '4 MS/s' },
  { value: '12000000', label: '12 MS/s' },
  { value: '24000000', label: '24 MS/s' },
  { value: '48000000', label: '48 MS/s' },
]
const ADC_RATES = [
  { value: '10000', label: '10 kS/s' },
  { value: '100000', label: '100 kS/s' },
  { value: '400000', label: '400 kS/s' },
]
const ADC_SOURCES = [
  { value: 'ext', label: 'SMA input' },
  { value: 'current_in', label: '4-20 mA input' },
]
const PRE_OPTIONS = [
  { value: '0', label: 'nothing' },
  { value: '0.1', label: '10 %' },
  { value: '0.25', label: '25 %' },
  { value: '0.5', label: '50 %' },
]
const EDGES = [
  { value: 'rising', label: 'rising' },
  { value: 'falling', label: 'falling' },
  { value: 'high', label: 'high' },
  { value: 'low', label: 'low' },
]
const PROTOCOLS = [
  { value: 'uart', label: 'UART' },
  { value: 'i2c', label: 'I2C' },
  { value: 'spi', label: 'SPI' },
  { value: 'usb', label: 'USB' },
  { value: 'modbus', label: 'Modbus' },
  { value: 'can', label: 'CAN' },
  { value: 'pwm', label: 'PWM' },
  { value: 'onewire', label: '1-Wire' },
  { value: 'smbus', label: 'SMBus' },
  { value: 'pmbus', label: 'PMBus' },
]
const PEC_OPTIONS = [
  { value: 'auto', label: 'auto' },
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
]
const USB_SPEEDS = [
  { value: 'auto', label: 'auto' },
  { value: 'full', label: 'full' },
  { value: 'low', label: 'low' },
]
const CHANNELS = Array.from({ length: 14 }, (_, i) => i + 1)
const CH_OPTIONS = CHANNELS.map((c) => ({ value: String(c), label: `LA${c}` }))
/** The most samples one capture takes (the tools' limit). */
const MAX_SAMPLES = 8_000_000

type Wiring = { uart_baud?: number; pins?: { la: number; wired_to?: string | null }[] }

/** The first channel whose signal name matches, for decoders the wiring has no role for. */
function namedChannel(w: Wiring | null, re: RegExp, skip?: string | null): string | null {
  const p = w?.pins?.find((x) => x.wired_to && re.test(x.wired_to) && String(x.la) !== skip)
  return p ? String(p.la) : null
}

function roleChannel(w: Wiring | null, role: string): string | null {
  const p = w?.pins?.find((x) => x.wired_to === role)
  return p ? String(p.la) : null
}

function activeChannels(la: LaCaptureData): number[] {
  let changed = 0
  for (let k = 1; k < la.edges.length; k++) changed |= la.edges[k][1] ^ la.edges[k - 1][1]
  return CHANNELS.filter((c) => changed & (1 << (c - 1)))
}

export function CaptureView({
  call,
  fetchCapture,
  refreshKey,
  decodeActions,
  controls = true,
}: {
  call: BenchCall
  fetchCapture: FetchCapture
  /** Changes when a capture may have happened elsewhere (the agent's): the view reloads the last one. */
  refreshKey?: unknown
  /** Extra controls on each decode row (the bus console's Send again). */
  decodeActions?: DecodeRowActions
  /** false hides the capture controls: the host shows a capture made elsewhere (a send and capture). */
  controls?: boolean
}) {
  const colors = useCanvasColors()
  const [mode, setMode] = useState<Mode>('la')
  const [duration, setDuration] = useState('0.01')
  const [laRate, setLaRate] = useState('1000000')
  const [adcRate, setAdcRate] = useState('100000')
  const [source, setSource] = useState('ext')
  const [trigger, setTrigger] = useState<string | null>(null)
  const [edge, setEdge] = useState('rising')
  /** Logic captures: the share of the samples kept from before the trigger. */
  const [pre, setPre] = useState('0.1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [la, setLa] = useState<LaCaptureData | null>(null)
  const [adc, setAdc] = useState<AdcCaptureData | null>(null)
  const [visible, setVisible] = useState<number[]>([1, 2, 3, 4])
  const [wiring, setWiring] = useState<Wiring | null>(null)
  // decode
  const [protocol, setProtocol] = useState('uart')
  const [ch, setCh] = useState<Record<string, string | null>>({})
  const [baud, setBaud] = useState<number | ''>('')
  const [spiMode, setSpiMode] = useState('0')
  const [usbSpeed, setUsbSpeed] = useState('auto')
  const [bitrate, setBitrate] = useState<number | ''>(500000)
  const [dataBitrate, setDataBitrate] = useState<number | ''>('')
  const [pwmChannels, setPwmChannels] = useState<string[]>(['1'])
  const [servo, setServo] = useState(false)
  const [pec, setPec] = useState('auto')
  const [decoded, setDecoded] = useState<DecodeData | null>(null)
  const [overlay, setOverlay] = useState(true)

  // The wiring names the lanes and fills in the decode channels.
  useEffect(() => {
    void call('wiring', {}, { poll: true }).then((r) => {
      const w = benchData<Wiring>(r)
      if (!w) return
      setWiring(w)
      setCh({
        sda: roleChannel(w, 'i2c_sda'),
        scl: roleChannel(w, 'i2c_scl'),
        rx: roleChannel(w, 'uart_rx'),
        sclk: roleChannel(w, 'spi_sclk'),
        mosi: roleChannel(w, 'spi_mosi'),
        miso: roleChannel(w, 'spi_miso'),
        cs: roleChannel(w, 'spi_cs'),
        dp: roleChannel(w, 'usb_dp') ?? namedChannel(w, /^(usb[_ -]?)?(d\+|dp|dplus)$/i),
        dm: roleChannel(w, 'usb_dm') ?? namedChannel(w, /^(usb[_ -]?)?(d-|dm|dminus)$/i),
        can: namedChannel(w, /can.*(rx|rxd)|^rxd$/i),
        onewire: namedChannel(w, /1[-_ ]?wire|onewire|^ow$/i),
        // Only a signal named for it: the uart_tx role is usually the console's line.
        tx: namedChannel(w, /modbus.*tx|rs-?485.*(di|tx)/i, roleChannel(w, 'uart_rx')),
      })
      if (w.uart_baud) setBaud(w.uart_baud)
    })
  }, [call])

  const laNames = useMemo(() => CHANNELS.map((c) => wiring?.pins?.find((p) => p.la === c)?.wired_to ?? ''), [wiring])

  /** Load the last captures and decode from the host; keep what did not change. */
  const load = useCallback(async () => {
    try {
      const [l, a, d] = await Promise.all([fetchCapture('la'), fetchCapture('adc'), fetchCapture('decode')])
      setLa((old) => {
        if (!l.seq) return null
        if (old?.seq === l.seq) return old
        const act = activeChannels(l)
        const named = CHANNELS.filter((c) => laNames[c - 1])
        const next = [...new Set([...act, ...named])].sort((x, y) => x - y)
        if (next.length) setVisible(next)
        return l
      })
      setAdc((old) => (!a.seq ? null : old?.seq === a.seq ? old : a))
      const dec = d.seq && (d.transactions || d.frames || d.packets || (d.protocol === 'pwm' && d.channels)) ? d : null
      setDecoded(dec)
      // A decode made elsewhere (the agent, the bus console): the picker shows its protocol.
      if (dec?.protocol && PROTOCOLS.some((x) => x.value === dec.protocol)) setProtocol(dec.protocol)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [fetchCapture, laNames])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const capture = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const dur = Number(duration)
      const laN = Math.max(16, Math.min(MAX_SAMPLES, Math.round(dur * Number(laRate))))
      const adcN = Math.max(16, Math.min(MAX_SAMPLES, Math.round(dur * Number(adcRate))))
      const trig: Record<string, unknown> = trigger ? { trigger_la: Number(trigger), trigger_edge: edge } : {}
      // What led up to the trigger (a UART byte's start bit, say) stays in the capture.
      const preN = trigger ? Math.round(laN * Number(pre)) : 0
      let r
      if (mode === 'la') r = await call('capture_la', { samples: laN, sample_rate_hz: Number(laRate), ...trig, ...(preN ? { trigger_pre_samples: preN } : {}) })
      else if (mode === 'adc') r = await call('capture_adc', { samples: adcN, sample_rate_hz: Number(adcRate), source, ...trig })
      else
        r = await call('capture_correlated', {
          la_samples: laN,
          la_sample_rate_hz: Number(laRate),
          adc_samples: adcN,
          adc_sample_rate_hz: Number(adcRate),
          source,
          ...trig,
        })
      const e = benchError(r)
      if (e) setError(e)
      else await load()
    } finally {
      setBusy(false)
    }
  }

  const decode = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const n = (k: string) => (ch[k] ? Number(ch[k]) : undefined)
      const args: Record<string, unknown> = { protocol, capture: 'last', max_items: 1 }
      if (protocol === 'i2c') Object.assign(args, { sda: n('sda'), scl: n('scl') })
      else if (protocol === 'uart') Object.assign(args, { rx: n('rx'), baud: baud || undefined })
      else if (protocol === 'usb') Object.assign(args, { dp: n('dp'), dm: n('dm'), speed: usbSpeed })
      else if (protocol === 'modbus') Object.assign(args, { rx: n('rx'), tx: n('tx'), baud: baud || undefined })
      else if (protocol === 'can') Object.assign(args, { can: n('can'), bitrate: bitrate || undefined, data_bitrate: dataBitrate || undefined })
      else if (protocol === 'pwm') Object.assign(args, { channels: pwmChannels.map(Number), servo })
      else if (protocol === 'onewire') Object.assign(args, { onewire: n('onewire') })
      else if (protocol === 'smbus' || protocol === 'pmbus') Object.assign(args, { sda: n('sda'), scl: n('scl'), pec })
      else Object.assign(args, { sclk: n('sclk'), mosi: n('mosi'), miso: n('miso'), cs: n('cs'), mode: Number(spiMode) })
      for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k]
      const r = await call('decode_la', args)
      const e = benchError(r)
      if (e) setError(e)
      else setDecoded(await fetchCapture('decode'))
    } finally {
      setBusy(false)
    }
  }

  const laEdges = useMemo<LaEdge[]>(() => (la ? la.edges.map(([i, w]) => ({ i, w })) : []), [la])
  // An ADC capture drawn with an LA capture shares its time axis only when one trigger took both.
  const showAdc = !!adc && (!la || mode !== 'la' || !!adc.correlated)
  const showLa = !!la && (!adc || mode !== 'adc' || !!la.correlated)
  const result = decoded && decoded.seq === la?.seq && decoded.protocol ? (decoded as DecodeResult & DecodeData) : null
  const annotations = useMemo(() => {
    if (!result || !overlay) return []
    const c = (Array.isArray(result.channels) ? {} : result.channels ?? {}) as Record<string, number>
    return decodeAnnotations(result, { sda: c.sda, rx: c.rx, mosi: c.mosi, miso: c.miso, dp: c.dp, can: c.can, onewire: c.onewire })
  }, [result, overlay])

  const chOptions = useMemo(() => CHANNELS.map((c) => ({ value: String(c), label: laNames[c - 1] ? `LA${c} ${laNames[c - 1]}` : `LA${c}` })), [laNames])
  // The capture rate the chosen decoder needs: a capture that is too slow says so before Decode,
  // and the rate menu can be set to the lowest rate that is enough for the next capture.
  const rateHint = useMemo(() => {
    const need = decodeRateNeed(protocol, {
      baud: typeof baud === 'number' ? baud : undefined,
      bitrate: typeof bitrate === 'number' ? bitrate : undefined,
      dataBitrate: typeof dataBitrate === 'number' ? dataBitrate : undefined,
      speed: usbSpeed,
    })
    if (!need) return null
    const name = PROTOCOLS.find((p) => p.value === protocol)?.label ?? protocol
    const enough = LA_RATES.map((r) => Number(r.value)).find((r) => r >= need)
    const what = protocol === 'usb' && usbSpeed !== 'low' ? `${name} full speed` : name
    const low = protocol === 'usb' && usbSpeed === 'auto' ? ' Low speed: 6 MS/s.' : ''
    if (la && la.sample_rate_hz < need * 0.99)
      return { text: `${what} needs ${fmtSi(need, 'S/s')} or more: this capture is ${fmtSi(la.sample_rate_hz, 'S/s')}.${low}`, use: enough && Number(laRate) < need ? enough : undefined }
    if (Number(laRate) < need * 0.99) return { text: `${what} needs ${fmtSi(need, 'S/s')} or more for the next capture.${low}`, use: enough }
    return null
  }, [protocol, baud, bitrate, dataBitrate, usbSpeed, la, laRate])

  const chSelect = (key: string, label: string) => (
    <Select
      key={key}
      size="xs"
      w={120}
      label={label}
      data={chOptions}
      value={ch[key] ?? null}
      onChange={(v) => setCh((o) => ({ ...o, [key]: v }))}
      clearable={key === 'cs' || key === 'mosi' || key === 'miso' || key === 'tx'}
      comboboxProps={{ withinPortal: true }}
    />
  )

  return (
    <Stack gap="sm" p="sm">
      {controls ? (
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select size="xs" w={96} label="Capture" data={MODES} value={mode} onChange={(v) => v && setMode(v as Mode)} allowDeselect={false} />
        <Select size="xs" w={88} label="Length" data={DURATIONS} value={duration} onChange={(v) => v && setDuration(v)} allowDeselect={false} />
        {mode !== 'adc' ? <Select size="xs" w={104} label="Logic rate" data={LA_RATES} value={laRate} onChange={(v) => v && setLaRate(v)} allowDeselect={false} /> : null}
        {mode !== 'la' ? <Select size="xs" w={120} label="Analog input" data={ADC_SOURCES} value={source} onChange={(v) => v && setSource(v)} allowDeselect={false} /> : null}
        {mode !== 'la' ? <Select size="xs" w={104} label="Analog rate" data={ADC_RATES} value={adcRate} onChange={(v) => v && setAdcRate(v)} allowDeselect={false} /> : null}
        <Select size="xs" w={92} label="Trigger" placeholder="none" data={CH_OPTIONS} value={trigger} onChange={setTrigger} clearable />
        {trigger ? <Select size="xs" w={88} label="on" data={EDGES} value={edge} onChange={(v) => v && setEdge(v)} allowDeselect={false} /> : null}
        {trigger && mode === 'la' ? <Select size="xs" w={96} label="Before it" aria-label="Before the trigger" data={PRE_OPTIONS} value={pre} onChange={(v) => v && setPre(v)} allowDeselect={false} /> : null}
        <Button size="xs" onClick={() => void capture()} loading={busy}>
          Capture
        </Button>
      </Group>
      ) : null}

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}

      {showLa || showAdc ? (
        <>
          <Text size="xs" c="dimmed" ff="monospace">
            {showLa && la ? `logic ${la.count.toLocaleString()} samples at ${fmtSi(la.sample_rate_hz, 'S/s')}` : ''}
            {showLa && showAdc ? ' · ' : ''}
            {showAdc && adc ? `analog ${adc.count.toLocaleString()} samples at ${fmtSi(adc.sample_rate_hz, 'S/s')}${adc.source ? ` (${adc.source})` : ''}` : ''}
            {la?.stopped_early ? ` · stopped early (${la.stopped_early})` : ''}
            {' · drag to zoom, double-click to reset'}
          </Text>
          {showLa ? (
            <Chip.Group multiple value={visible.map(String)} onChange={(v) => setVisible(v.map(Number).sort((a, b) => a - b))}>
              <Group gap={4}>
                {CHANNELS.map((c) => (
                  <Chip key={c} value={String(c)} size="xs" variant="light">
                    LA{c}
                    {laNames[c - 1] ? ` ${laNames[c - 1]}` : ''}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          ) : null}
          <CaptureCanvas
            laEdges={showLa ? laEdges : []}
            laSampleCount={showLa && la ? la.count : 0}
            laRateHz={showLa && la ? la.sample_rate_hz : null}
            adcVolts={showAdc && adc ? adc.samples : []}
            adcRateHz={showAdc && adc ? adc.sample_rate_hz : null}
            adcUnit={adc?.unit ?? 'V'}
            visibleLa={showLa ? visible : []}
            laNames={laNames}
            showAdc={showAdc}
            colors={colors}
            zoomSessionKey={`${la?.seq ?? 0}-${adc?.seq ?? 0}`}
            annotations={annotations}
          />
        </>
      ) : (
        <Text size="sm" c="dimmed">
          {controls ? 'No capture yet. The agent\'s captures show here too.' : 'No capture yet.'}
        </Text>
      )}

      {showLa ? (
        <Stack gap={6}>
          <Group gap="xs" align="flex-end" wrap="wrap">
            <Select size="xs" w={96} label="Decode" data={PROTOCOLS} value={protocol} onChange={(v) => v && setProtocol(v)} allowDeselect={false} maxDropdownHeight={400} />
            {protocol === 'i2c' ? [chSelect('sda', 'SDA'), chSelect('scl', 'SCL')] : null}
            {protocol === 'uart'
              ? [
                  chSelect('rx', 'RX'),
                  <NumberInput key="baud" size="xs" w={96} label="Baud" value={baud} onChange={(v) => setBaud(typeof v === 'number' ? v : '')} min={300} max={10_000_000} hideControls />,
                ]
              : null}
            {protocol === 'spi'
              ? [
                  chSelect('sclk', 'SCLK'),
                  chSelect('mosi', 'MOSI'),
                  chSelect('miso', 'MISO'),
                  chSelect('cs', 'CS'),
                  <Select key="mode" size="xs" w={70} label="Mode" data={['0', '1', '2', '3']} value={spiMode} onChange={(v) => v && setSpiMode(v)} allowDeselect={false} />,
                ]
              : null}
            {protocol === 'smbus' || protocol === 'pmbus'
              ? [
                  chSelect('sda', 'SDA'),
                  chSelect('scl', 'SCL'),
                  <Select key="pec" size="xs" w={80} label="PEC" data={PEC_OPTIONS} value={pec} onChange={(v) => v && setPec(v)} allowDeselect={false} />,
                ]
              : null}
            {protocol === 'modbus'
              ? [
                  chSelect('rx', 'RX'),
                  chSelect('tx', 'TX'),
                  <NumberInput key="baud" size="xs" w={96} label="Baud" value={baud} onChange={(v) => setBaud(typeof v === 'number' ? v : '')} min={300} max={4_000_000} hideControls />,
                ]
              : null}
            {protocol === 'can'
              ? [
                  chSelect('can', 'RXD'),
                  <NumberInput key="br" size="xs" w={100} label="Bit rate" value={bitrate} onChange={(v) => setBitrate(typeof v === 'number' ? v : '')} min={10_000} max={5_000_000} hideControls />,
                  <NumberInput key="dbr" size="xs" w={100} label="FD data rate" value={dataBitrate} onChange={(v) => setDataBitrate(typeof v === 'number' ? v : '')} min={10_000} max={12_000_000} hideControls />,
                ]
              : null}
            {protocol === 'pwm' ? (
              <Group key="pwm" gap="xs" align="flex-end">
                <MultiSelect size="xs" w={260} label="Channels" data={chOptions} value={pwmChannels} onChange={setPwmChannels} comboboxProps={{ withinPortal: true }} />
                <Checkbox size="xs" label="Servo" checked={servo} onChange={(e) => setServo(e.currentTarget.checked)} mb={6} />
              </Group>
            ) : null}
            {protocol === 'onewire' ? chSelect('onewire', 'Data') : null}
            {protocol === 'usb'
              ? [
                  chSelect('dp', 'D+'),
                  chSelect('dm', 'D-'),
                  <Select key="speed" size="xs" w={80} label="Speed" data={USB_SPEEDS} value={usbSpeed} onChange={(v) => v && setUsbSpeed(v)} allowDeselect={false} />,
                ]
              : null}
            <Button size="xs" variant="light" onClick={() => void decode()} loading={busy}>
              Decode
            </Button>
            {result ? <Switch size="xs" label="On the waveform" checked={overlay} onChange={(e) => setOverlay(e.currentTarget.checked)} /> : null}
          </Group>
          {rateHint ? (
            <Alert color="yellow" variant="light" p="xs">
              <Group gap="xs" wrap="nowrap" justify="space-between">
                <Text size="xs">{rateHint.text}</Text>
                {rateHint.use ? (
                  <Button size="compact-xs" variant="light" color="yellow" onClick={() => setLaRate(String(rateHint.use))}>
                    Use {fmtSi(rateHint.use, 'S/s')}
                  </Button>
                ) : null}
              </Group>
            </Alert>
          ) : null}
          {result ? <DecodeTable result={result} actions={decodeActions} /> : null}
        </Stack>
      ) : null}
    </Stack>
  )
}
