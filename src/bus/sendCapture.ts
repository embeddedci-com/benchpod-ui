// Send and capture: one I2C, SPI or gpio transaction run as capture_la's `send`, so the capture
// arms first and triggers on the line the transaction starts with (SDA falling, CS falling, the
// gpio pin's edge; the MCP tool picks it). The SDK keeps 64 samples from before the trigger when
// none are asked for, so the start of the transaction is in the trace.

/** capture_la's `send` (SendSpec in embeddedci-mcp). */
export type SendSpec =
  | { bus: 'i2c'; addr: number; write_hex: string; read: number }
  | { bus: 'spi'; tx_hex: string; spi_mode: number; spi_hz: number }
  | { bus: 'gpio'; la: number; level: 0 | 1 }

/** What the capture's send did (SendResultModel). */
export type SendResult = {
  bus: string
  ack?: boolean | null
  rx_hex?: string
  nack_at?: number | null
  la?: number | null
  level?: number | null
  /** Why the transfer failed; the capture still returned. */
  error?: string | null
}

export type SendCaptureOutcome = {
  /** The capture failed (the pod's text), or the send did (send.error). */
  error?: string
  send?: SendResult
  /** The user said no to the confirmation. */
  declined?: boolean
}

/**
 * Runs a send with a capture: the dashboard gives this to the tabs. `hz` is the bus rate (sizes
 * the capture), `decode` the decode_la arguments to decode the capture with (none for gpio).
 */
export type SendCapture = (send: SendSpec, opts?: { hz?: number; decode?: Record<string, unknown> }) => Promise<SendCaptureOutcome>

/** The most bytes a send writes or reads (the pod's limit for a capture's send). */
export const SEND_MAX_BYTES = 32

/** Samples taken from before the trigger (the SDK's default for a send). */
export const SEND_PRE_SAMPLES = 64

const LA_RATES = [1_000_000, 4_000_000, 12_000_000, 24_000_000, 48_000_000]
const MIN_SAMPLES = 2048
/** A trigger that never comes (a gpio pin already at the level) fails fast. */
export const SEND_TRIGGER_TIMEOUT_S = 2

/** The smallest LA rate at or above `want`, up to 48 MS/s. */
function rateFor(want: number): number {
  return LA_RATES.find((r) => r >= want) ?? LA_RATES[LA_RATES.length - 1]
}

/**
 * capture_la's arguments for a send: a rate of about 8 samples per bit (10 for I2C), and enough
 * samples for the whole transaction with room to spare (a real I2C bus runs slower than nominal).
 */
export function captureArgs(send: SendSpec, hz?: number): Record<string, unknown> {
  let rate = 1_000_000
  let seconds = 0.002
  if (send.bus === 'i2c') {
    const f = hz || 100_000
    const bytes = 1 + send.write_hex.length / 2 + (send.read ? 1 + send.read : 0)
    rate = rateFor(f * 10)
    seconds = ((bytes * 9 + 4) / f) * 1.5 + 50e-6
  } else if (send.bus === 'spi') {
    const f = send.spi_hz
    rate = rateFor(f * 8)
    seconds = ((send.tx_hex.length / 2) * 8) / f + 20e-6
  }
  const samples = Math.max(MIN_SAMPLES, Math.ceil(seconds * rate) + SEND_PRE_SAMPLES)
  return { samples, sample_rate_hz: rate, trigger_timeout: SEND_TRIGGER_TIMEOUT_S, send }
}
