import type { DecodeTransaction, SpiFrame } from '../capture/DecodeTables'

// Send again: a decoded transaction from the trace back into the I2C or SPI tab's send box.

export type SendAgain =
  | { bus: 'i2c'; addr: number; write_hex: string; read: number }
  | { bus: 'spi'; tx_hex: string }

/** What to send again, and whether to send it at once (else only fill the send box). */
export type SendAgainRequest = SendAgain & { now: boolean }

/** An I2C transaction as its address, the bytes written and the count read; null without an address. */
export function i2cSendAgain(t: DecodeTransaction): SendAgain | null {
  const addr = parseInt(t.address, 16)
  if (!t.address || Number.isNaN(addr) || addr > 127) return null
  let write = ''
  let read = 0
  for (const s of t.segments) {
    if (s.type === 'data-write' && s.value) write += (parseInt(s.value, 16) & 0xff).toString(16).padStart(2, '0')
    else if (s.type === 'data-read') read++
  }
  return { bus: 'i2c', addr, write_hex: write, read }
}

/**
 * SPI words grouped into transfers: a gap longer than four words starts a new one (the decode
 * gives words, not CS frames). Each group is keyed by the index of its first word.
 */
export function spiBursts(frames: SpiFrame[]): Map<number, SendAgain> {
  const out = new Map<number, SendAgain>()
  let first: SpiFrame | null = null
  let tx = ''
  let prev: SpiFrame | null = null
  const flush = () => {
    if (first && tx) out.set(first.index, { bus: 'spi', tx_hex: tx })
  }
  for (const f of frames) {
    const word = Math.max(f.end_us - f.start_us, 0.001)
    if (prev && f.start_us - prev.end_us > 4 * word) {
      flush()
      first = null
      tx = ''
    }
    if (!first) first = f
    tx += (f.mosi & 0xff).toString(16).padStart(2, '0')
    prev = f
  }
  flush()
  return out
}
