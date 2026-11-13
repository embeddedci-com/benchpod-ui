// What the format says about kinds, faults and stimulus segments (benchpod-sensors
// docs/format.md, sections 7 and 8), as data the editors draw from.
import type { DefinitionKind, SensorKind } from './engine'

export const SENSOR_KINDS: SensorKind[] = ['i2c', 'spi', 'uart', 'analog']

export const KIND_LABELS: Record<DefinitionKind, string> = {
  i2c: 'I2C',
  spi: 'SPI',
  uart: 'UART',
  analog: 'Analog',
  stimulus: 'Stimulus',
}

/** The pins each kind takes in sensor_start (`pins`), required first. Analog takes `output`. */
export const KIND_PINS: Record<SensorKind, { key: string; label: string; required: boolean }[]> = {
  i2c: [
    { key: 'sda', label: 'SDA', required: true },
    { key: 'scl', label: 'SCL', required: true },
    { key: 'drdy', label: 'Data ready', required: false },
  ],
  spi: [
    { key: 'sclk', label: 'SCLK', required: true },
    { key: 'mosi', label: 'MOSI', required: true },
    { key: 'miso', label: 'MISO', required: true },
    { key: 'cs', label: 'CS', required: true },
    // The emulated SPI target has no data-ready pin.
  ],
  uart: [
    { key: 'tx', label: 'TX (pod to DUT)', required: true },
    { key: 'rx', label: 'RX (DUT to pod)', required: false },
  ],
  analog: [],
}

export type FaultField = 'param' | 'value' | 'at' | 'mask' | 'rate_hz'

export type FaultType = {
  type: string
  label: string
  kinds: SensorKind[]
  /** Fields the fault needs (the others are optional or unused). */
  needs: FaultField[]
  /** Fields it may take. */
  takes: FaultField[]
  help: string
}

export const FAULT_TYPES: FaultType[] = [
  { type: 'stuck', label: 'Stuck', kinds: ['i2c', 'spi', 'uart', 'analog'], needs: [], takes: ['param', 'value'], help: 'Readings freeze.' },
  { type: 'offset', label: 'Offset', kinds: ['i2c', 'spi', 'uart', 'analog'], needs: ['param', 'value'], takes: [], help: 'A param reads this much higher.' },
  { type: 'gain', label: 'Gain', kinds: ['i2c', 'spi', 'uart', 'analog'], needs: ['param', 'value'], takes: [], help: 'A param reads times this value.' },
  { type: 'no_response', label: 'No response', kinds: ['i2c', 'spi', 'uart'], needs: [], takes: [], help: 'The sensor does not answer.' },
  { type: 'corrupt', label: 'Corrupt', kinds: ['i2c', 'spi'], needs: ['at', 'mask'], takes: [], help: 'A register reads XOR a mask.' },
  { type: 'bus_stuck', label: 'Bus stuck', kinds: ['i2c'], needs: [], takes: [], help: 'SDA held low (at most 1 s).' },
  { type: 'garbage', label: 'Garbage', kinds: ['uart'], needs: [], takes: ['rate_hz'], help: 'Random bytes instead of messages.' },
  { type: 'drop', label: 'Drop', kinds: ['uart'], needs: ['value'], takes: [], help: 'Each message is dropped with this probability.' },
  { type: 'baud_error', label: 'Baud error', kinds: ['uart'], needs: ['value'], takes: [], help: 'The baud rate is off by this many percent.' },
  { type: 'open', label: 'Open', kinds: ['analog'], needs: [], takes: ['value'], help: 'Output at the range minimum.' },
  { type: 'short', label: 'Short', kinds: ['analog'], needs: [], takes: ['value'], help: 'Output at the range maximum.' },
]

export const faultTypesFor = (kind: SensorKind): FaultType[] => FAULT_TYPES.filter((f) => f.kinds.includes(kind))

// ---- stimulus segments ----

export type SegmentShape = 'hold' | 'step' | 'ramp' | 'sine' | 'saw' | 'pulse' | 'noise' | 'data' | 'repeat'

export type SegmentField = {
  key: string
  label: string
  /** number (default), an optional number, or a choice. */
  type?: 'number' | 'optional' | 'interpolate'
  min?: number
  max?: number
  step?: number
  default?: number
}

const dur: SegmentField = { key: 'duration_s', label: 'Duration (s)', min: 0, step: 1, default: 5 }

/** The fields of each shape, in the order the editor shows them (format.md 7). */
export const SEGMENT_SHAPES: { shape: SegmentShape; label: string; fields: SegmentField[] }[] = [
  { shape: 'hold', label: 'Hold', fields: [{ key: 'value', label: 'Value', default: 0 }, dur] },
  { shape: 'step', label: 'Step', fields: [{ key: 'value', label: 'Value', default: 0 }] },
  {
    shape: 'ramp',
    label: 'Ramp',
    fields: [{ key: 'start', label: 'Start', type: 'optional' }, { key: 'end', label: 'End', default: 1 }, dur],
  },
  {
    shape: 'sine',
    label: 'Sine',
    fields: [
      { key: 'offset', label: 'Offset', default: 0 },
      { key: 'amplitude', label: 'Amplitude', default: 1 },
      { key: 'period_s', label: 'Period (s)', min: 0, default: 10 },
      { key: 'phase_deg', label: 'Phase (deg)', type: 'optional' },
      dur,
    ],
  },
  {
    shape: 'saw',
    label: 'Saw',
    fields: [{ key: 'low', label: 'Low', default: 0 }, { key: 'high', label: 'High', default: 1 }, { key: 'period_s', label: 'Period (s)', min: 0, default: 10 }, dur],
  },
  {
    shape: 'pulse',
    label: 'Pulse',
    fields: [
      { key: 'low', label: 'Low', default: 0 },
      { key: 'high', label: 'High', default: 1 },
      { key: 'period_s', label: 'Period (s)', min: 0, default: 2 },
      { key: 'duty', label: 'Duty (0-1)', min: 0, max: 1, step: 0.05, default: 0.5 },
      dur,
    ],
  },
  {
    shape: 'noise',
    label: 'Noise',
    fields: [
      { key: 'mean', label: 'Mean', type: 'optional' },
      { key: 'sigma', label: 'Sigma', min: 0, default: 0.1 },
      { key: 'seed', label: 'Seed', type: 'optional', step: 1 },
      dur,
    ],
  },
  { shape: 'data', label: 'Data', fields: [{ key: 'interpolate', label: 'Between points', type: 'interpolate' }] },
  { shape: 'repeat', label: 'Repeat', fields: [{ key: 'count', label: 'Count', min: 1, step: 1, default: 2 }] },
]

export const shapeInfo = (shape: string) => SEGMENT_SHAPES.find((s) => s.shape === shape)

/** A new segment of a shape, with its defaults. */
export function newSegment(shape: SegmentShape): Record<string, unknown> {
  const seg: Record<string, unknown> = { shape }
  for (const f of shapeInfo(shape)?.fields ?? []) {
    if (f.type === 'interpolate') seg[f.key] = 'linear'
    else if (f.default !== undefined) seg[f.key] = f.default
  }
  if (shape === 'data') seg.points = [[0, 0], [10, 1]]
  if (shape === 'repeat') seg.segments = [newSegment('ramp')]
  return seg
}
