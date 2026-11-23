import { isLaChannel, type Wiring } from './model'

/** The debug port the pod's probe uses to reach the board. */
export type DebugTransport = 'swd' | 'jtag'

/** OpenOCD target configs (base name) of parts that have JTAG and no SWD; any riscv* config too. */
const JTAG_ONLY_TARGETS = new Set(['esp32', 'esp32s2', 'gd32vf103', 'fe310', 'k210'])

/** Whether an OpenOCD target config (`target/esp32.cfg`) names a part that has JTAG only. */
export function jtagOnlyTarget(target: string): boolean {
  const name = (target.trim().split('/').pop() ?? '').replace(/\.cfg$/i, '').toLowerCase()
  return JTAG_ONLY_TARGETS.has(name) || name.startsWith('riscv')
}

type PinProfile = Partial<Pick<Wiring, 'swd_swclk' | 'swd_swdio' | 'jtag_tck' | 'jtag_tms' | 'jtag_tdi' | 'jtag_tdo'>>

/** Whether both SWD pins are wired. */
export function swdWired(w: PinProfile | null | undefined): boolean {
  return !!w && isLaChannel(w.swd_swclk) && isLaChannel(w.swd_swdio)
}

/** Whether all four JTAG pins are wired (nTRST is optional). */
export function jtagWired(w: PinProfile | null | undefined): boolean {
  return !!w && isLaChannel(w.jtag_tck) && isLaChannel(w.jtag_tms) && isLaChannel(w.jtag_tdi) && isLaChannel(w.jtag_tdo)
}

/**
 * The port the host tools use, the same rule everywhere: JTAG when all four JTAG pins are wired
 * and there are no SWD pins or the target only has JTAG; else SWD. null: neither is wired.
 */
export function debugTransport(w: PinProfile | null | undefined, target = ''): DebugTransport | null {
  const swd = swdWired(w)
  const jtag = jtagWired(w)
  if (jtag && (!swd || jtagOnlyTarget(target))) return 'jtag'
  return swd ? 'swd' : null
}
