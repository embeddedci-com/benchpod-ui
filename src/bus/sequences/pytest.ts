import type { BusSequence, SequenceStep } from './model'

// A saved sequence as a pytest file for the embeddedci SDK (its pytest plugin gives the
// `benchpod` fixture). Pure: the same input gives the same text, so the web app and the desktop
// export the same file. Each step becomes the SDK call the MCP tool makes; each read gets an
// assert with what it saw when the sequence was recorded, for the user to edit.

export type PytestOptions = {
  /** The wiring's signal names by LA channel (index 0 = LA1): added as comments next to channel numbers. */
  names?: readonly string[]
  /** For the header; today when left out. */
  date?: Date
}

type Ctx = {
  out: string[]
  ind: string
  names: readonly string[]
  imports: Set<string>
  /** Session variables open now: i2c, can, uart. */
  open: Set<string>
  stack: boolean
}

const IND = '    '

/** A file name for the export: test_<slug>.py. */
export function pytestFileName(name: string): string {
  return `test_${slug(name)}.py`
}

/** The sequence name as a Python identifier part. */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (/^[0-9]/.test(s) ? `seq_${s}` : s) || 'sequence'
}

/** Python literal for a string (JSON's escapes are valid in Python). */
export const pyStr = (s: string) => JSON.stringify(s)

/** Python int: 400_000, not 400000. */
export function pyInt(n: number): string {
  const s = String(Math.trunc(n))
  if (Math.abs(n) < 10_000) return s
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '_')
}

function pyNum(n: number): string {
  return Number.isInteger(n) ? pyInt(n) : String(n)
}

const pyHex = (n: number) => `0x${Math.trunc(n).toString(16).padStart(2, '0')}`

function hexOf(v: unknown): string {
  return String(v ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** bytes.fromhex("01 02 ff"), spaced so it is easy to edit. */
export function pyBytes(hex: string): string {
  const h = hexOf(hex)
  return `bytes.fromhex(${pyStr(h.match(/../g)?.join(' ') ?? '')})`
}

function bytesOfList(v: unknown): string {
  const list = Array.isArray(v) ? v.map(Number) : []
  return pyBytes(list.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(''))
}

/** An LA reference: a number stays a number, a wiring name stays a name. */
function pyLa(v: unknown): string {
  return typeof v === 'number' ? String(v) : pyStr(String(v))
}

function laList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
}

/** A wiring name as its channel number when the wiring names it, else as it is. */
function numbered(ctx: Ctx, v: unknown): unknown {
  if (typeof v !== 'string') return v
  const i = ctx.names.findIndex((n) => n && n.toLowerCase() === v.trim().toLowerCase())
  return i >= 0 ? i + 1 : v
}

/** "  # LA3 READY" for channel numbers the wiring names. */
function laComment(ctx: Ctx, las: unknown[]): string {
  const named = las.filter((x): x is number => typeof x === 'number' && !!ctx.names[x - 1]).map((x) => `LA${x} ${ctx.names[x - 1]}`)
  return named.length ? `  # ${named.join(', ')}` : ''
}

function kw(pairs: [string, string | undefined][]): string {
  return pairs
    .filter((p): p is [string, string] => p[1] !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

function args(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p !== undefined && p !== '').join(', ')
}

const has = (a: Record<string, unknown>, k: string) => a[k] !== undefined && a[k] !== null

function line(ctx: Ctx, s: string) {
  ctx.out.push(ctx.ind + s)
}

/** Opens a session from the wiring when a step needs one the sequence did not open. */
function ensure(ctx: Ctx, v: 'i2c' | 'can' | 'uart') {
  if (ctx.open.has(v)) return
  const open = { i2c: 'bp.open_i2c()', can: 'bp.open_can()', uart: 'bp.open_uart()' }[v]
  line(ctx, `# The recorded sequence used a session it did not open; this one is opened from the wiring.`)
  line(ctx, `${v} = stack.enter_context(${open})`)
  ctx.open.add(v)
}

function stepCode(ctx: Ctx, s: SequenceStep, n: number) {
  const a = s.args ?? {}
  const e = s.expect
  switch (s.tool) {
    case 'set_pull': {
      // enable_pullup takes channel numbers: a wiring name becomes its channel when the wiring has it.
      const las = laList(a.las).map((x) => numbered(ctx, x))
      line(ctx, `bp.${a.enabled ? 'enable' : 'disable'}_pullup(${las.map((x) => (typeof x === 'number' ? String(x) : `bp.wiring.la(${pyStr(String(x))})`)).join(', ')})${laComment(ctx, las)}`)
      return
    }
    case 'i2c_open': {
      const opts = kw([
        ['sda', has(a, 'sda') ? pyLa(a.sda) : undefined],
        ['scl', has(a, 'scl') ? pyLa(a.scl) : undefined],
        ['hz', has(a, 'hz') ? pyInt(Number(a.hz)) : undefined],
        ['pullups', has(a, 'pullups') ? pyStr(String(a.pullups)) : undefined],
      ])
      if (ctx.open.has('i2c')) line(ctx, 'i2c.close()')
      line(ctx, `i2c = stack.enter_context(bp.open_i2c(${opts}))${laComment(ctx, [a.sda, a.scl])}`)
      ctx.open.add('i2c')
      return
    }
    case 'i2c_close':
      if (ctx.open.has('i2c')) line(ctx, 'i2c.close()')
      ctx.open.delete('i2c')
      return
    case 'i2c_transfer': {
      ensure(ctx, 'i2c')
      const addr = pyHex(Number(a.addr))
      const w = hexOf(a.write_hex)
      const r = Number(a.read ?? 0)
      if (e?.ack === false) {
        line(ctx, `assert not i2c.xfer(${args(addr, w ? pyBytes(w) : undefined, r ? `read=${r}` : undefined)}).ack  # NACK when recorded`)
        return
      }
      if (!w && !r) {
        line(ctx, `assert i2c.probe(${addr})`)
        return
      }
      if (!r) {
        if (w.length >= 4) line(ctx, `i2c.write_reg(${addr}, ${pyHex(parseInt(w.slice(0, 2), 16))}, ${pyBytes(w.slice(2))})`)
        else line(ctx, `i2c.write(${addr}, ${pyBytes(w)})`)
        return
      }
      const read = !w ? `i2c.read(${addr}, ${r})` : w.length === 2 ? `i2c.read_reg(${addr}, ${pyHex(parseInt(w, 16))}, ${r})` : `i2c.write_read(${addr}, ${pyBytes(w)}, ${r})`
      line(ctx, e?.rx_hex !== undefined ? `assert ${read} == ${pyBytes(e.rx_hex)}` : read)
      return
    }
    case 'i2c_scan': {
      ensure(ctx, 'i2c')
      const range = has(a, 'start') || has(a, 'end') ? args(pyHex(Number(a.start ?? 0x08)), pyHex(Number(a.end ?? 0x77))) : ''
      const scan = `i2c.scan(${range})`
      line(ctx, e?.found ? `assert ${scan} == [${e.found.map(pyHex).join(', ')}]` : scan)
      return
    }
    case 'spi_transfer': {
      const opts = kw([
        ['sck', has(a, 'sck') ? pyLa(a.sck) : undefined],
        ['mosi', has(a, 'mosi') ? pyLa(a.mosi) : undefined],
        ['miso', has(a, 'miso') ? pyLa(a.miso) : undefined],
        ['cs', has(a, 'cs') ? pyLa(a.cs) : undefined],
        ['hz', has(a, 'hz') ? pyInt(Number(a.hz)) : undefined],
        ['mode', has(a, 'mode') && Number(a.mode) !== 0 ? String(Number(a.mode)) : undefined],
      ])
      const xfer = `spi.transfer(${pyBytes(String(a.tx_hex ?? ''))})`
      line(ctx, `with bp.open_spi(${opts}) as spi:${laComment(ctx, [a.sck, a.mosi, a.miso, a.cs])}`)
      line(ctx, IND + (e?.rx_hex !== undefined ? `assert ${xfer} == ${pyBytes(e.rx_hex)}` : xfer))
      return
    }
    case 'gpio_mode': {
      const las = laList(a.la)
      const opts = kw([['level', has(a, 'level') ? String(Number(a.level)) : undefined]])
      line(ctx, `bp.configure_gpio(${args(`[${las.map(pyLa).join(', ')}]`, pyStr(String(a.mode ?? 'output')), opts)})${laComment(ctx, las)}`)
      return
    }
    case 'gpio_write': {
      const las = laList(a.la)
      const target = las.length === 1 ? pyLa(las[0]) : `[${las.map(pyLa).join(', ')}]`
      line(ctx, `bp.set_gpio(${target}, ${Number(a.level)})${laComment(ctx, las)}`)
      return
    }
    case 'gpio_read': {
      const levels = e?.levels ?? []
      if (!levels.length) {
        line(ctx, 'bp.pin_levels()')
        return
      }
      const v = `levels_${n}`
      line(ctx, `${v} = bp.pin_levels()`)
      for (const l of levels) line(ctx, `assert ${v}[${l.la}] == ${l.level}${laComment(ctx, [l.la])}`)
      return
    }
    case 'gpio_pulse': {
      const opts = kw([
        ['steps', pyInt(Number(a.count ?? 1))],
        ['delay', pyNum(Number(a.width))],
      ])
      line(ctx, `bp.la_step(${args(pyLa(a.la), opts)})  # ${Number(a.count ?? 1)} pulse(s), ${pyNum(Number(a.width))} s high${laComment(ctx, [a.la]).replace('  #', ',')}`)
      return
    }
    case 'gpio_wait': {
      const call = `bp.wait_for_level(${args(pyLa(a.la), String(Number(a.level ?? 1)), `timeout=${pyNum(Number(a.timeout ?? 5))}`)})`
      line(ctx, `assert ${e?.reached === false ? 'not ' : ''}${call}${e?.reached === false ? '  # timed out when recorded' : ''}${laComment(ctx, [a.la])}`)
      return
    }
    case 'gpio_release': {
      const las = laList(a.la)
      line(ctx, `bp.release_gpio(${las.map(pyLa).join(', ')})${laComment(ctx, las)}`)
      return
    }
    case 'can_open': {
      const opts = kw([
        ['bitrate', has(a, 'bitrate') ? pyInt(Number(a.bitrate)) : undefined],
        ['mode', has(a, 'mode') ? pyStr(String(a.mode)) : undefined],
        ['term', has(a, 'term') ? (a.term ? 'True' : 'False') : undefined],
        ['data_bitrate', has(a, 'data_bitrate') ? pyInt(Number(a.data_bitrate)) : undefined],
      ])
      if (ctx.open.has('can')) line(ctx, 'can.close()')
      line(ctx, `can = stack.enter_context(bp.open_can(${opts}))`)
      ctx.open.add('can')
      return
    }
    case 'can_write': {
      const opts = kw([
        ['ext', a.ext ? 'True' : undefined],
        ['rtr', a.rtr ? 'True' : undefined],
        ['fd', has(a, 'fd') ? (a.fd ? 'True' : 'False') : undefined],
        ['brs', has(a, 'brs') ? (a.brs ? 'True' : 'False') : undefined],
      ])
      line(ctx, `bp.can_write(${args(pyHex(Number(a.can_id)), has(a, 'data') ? bytesOfList(a.data) : undefined, opts)})`)
      return
    }
    case 'can_read': {
      ensure(ctx, 'can')
      const timeout = Number(a.timeout ?? 0)
      if (has(a, 'can_id')) {
        const v = `frame_${n}`
        line(ctx, `${v} = can.read_until(${pyHex(Number(a.can_id))}, timeout=${pyNum(timeout || 1)})`)
        const f = e?.frames?.[0]
        if (f) line(ctx, `assert ${v} is not None and ${v}.data == ${bytesOfList(f.data)}`)
        else line(ctx, `assert ${v} is None  # nothing came when recorded`)
        return
      }
      if (timeout > 0) {
        ctx.imports.add('import time')
        line(ctx, `time.sleep(${pyNum(timeout)})`)
      }
      const read = `can.read(${has(a, 'max_frames') ? pyInt(Number(a.max_frames)) : ''})`
      if (!e?.frames) {
        line(ctx, read)
        return
      }
      const v = `frames_${n}`
      line(ctx, `${v} = ${read}`)
      line(ctx, `assert [(f.id, f.data) for f in ${v}] == [${e.frames.map((f) => `(${pyHex(f.id)}, ${bytesOfList(f.data)})`).join(', ')}]`)
      return
    }
    case 'can_close':
      line(ctx, ctx.open.has('can') ? 'can.close()' : 'bp.can_disable()')
      ctx.open.delete('can')
      return
    case 'uart_open': {
      const opts = kw([
        ['rx', has(a, 'rx') ? pyLa(a.rx) : undefined],
        ['tx', has(a, 'tx') ? pyLa(a.tx) : undefined],
        ['baud', has(a, 'baud') ? pyInt(Number(a.baud)) : undefined],
      ])
      if (ctx.open.has('uart')) line(ctx, 'uart.close()')
      line(ctx, `uart = stack.enter_context(bp.open_uart(${opts}))`)
      ctx.open.add('uart')
      return
    }
    case 'uart_write': {
      ensure(ctx, 'uart')
      const end = a.line_ending === 'none' ? '' : a.line_ending === 'crlf' ? '\r\n' : '\n'
      line(ctx, `uart.write(${pyStr(String(a.text ?? '') + end)})`)
      return
    }
    case 'uart_close':
      if (ctx.open.has('uart')) line(ctx, 'uart.close()')
      ctx.open.delete('uart')
      return
    case 'capture_la':
      captureCode(ctx, a, s, n)
      return
    default:
      line(ctx, `# Step ${n}: ${s.tool}(${JSON.stringify(a).replace(/\n/g, ' ')}) has no SDK form here; add it by hand.`)
  }
}

function captureCode(ctx: Ctx, a: Record<string, unknown>, s: SequenceStep, n: number) {
  const send = (a.send ?? undefined) as Record<string, unknown> | undefined
  const v = `cap_${n}`
  let sendExpr: string | undefined
  let autoTrigger: string | undefined
  let spi: string | undefined
  if (send?.bus === 'i2c') {
    ensure(ctx, 'i2c')
    const w = hexOf(send.write_hex)
    const r = Number(send.read ?? 0)
    sendExpr = `i2c.send(${args(pyHex(Number(send.addr)), w ? pyBytes(w) : undefined, r ? `read=${r}` : undefined)})`
    autoTrigger = 'Trigger(i2c.sda, "falling")'
  } else if (send?.bus === 'spi') {
    ctx.imports.add('SpiSend')
    spi = kw([
      ['hz', has(send, 'spi_hz') ? pyInt(Number(send.spi_hz)) : undefined],
      ['mode', has(send, 'spi_mode') && Number(send.spi_mode) !== 0 ? String(Number(send.spi_mode)) : undefined],
    ])
    sendExpr = `SpiSend(${pyBytes(String(send.tx_hex ?? ''))})`
    autoTrigger = 'Trigger(spi.cs, "falling")'
  } else if (send?.bus === 'gpio') {
    ctx.imports.add('GpioSend')
    sendExpr = `GpioSend(${pyLa(send.la)}, ${Number(send.level)})`
    autoTrigger = `Trigger(${pyLa(send.la)}, ${pyStr(Number(send.level) === 0 ? 'falling' : 'rising')})`
  }
  let trigger: string | undefined
  if (has(a, 'trigger_la')) {
    trigger = `Trigger(${args(pyLa(a.trigger_la), pyStr(String(a.trigger_edge ?? 'rising')), Number(a.trigger_pre_samples ?? 0) ? pyInt(Number(a.trigger_pre_samples)) : undefined)})`
  } else if (autoTrigger) {
    const pre = Number(a.trigger_pre_samples ?? 0)
    trigger = pre ? autoTrigger.replace(/\)$/, `, ${pyInt(pre)})`) : autoTrigger
  }
  if (trigger) ctx.imports.add('Trigger')
  const opts = kw([
    ['sample_rate_hz', has(a, 'sample_rate_hz') ? pyNum(Number(a.sample_rate_hz)) : undefined],
    ['stop_dac_after', has(a, 'stop_dac_after') ? pyNum(Number(a.stop_dac_after)) : undefined],
    ['trigger', trigger],
    ['trigger_timeout', has(a, 'trigger_timeout') && Number(a.trigger_timeout) !== 10 ? pyNum(Number(a.trigger_timeout)) : undefined],
    ['send', sendExpr],
  ])
  const call = `${v} = bp.capture_la(${args(pyInt(Number(a.samples ?? 4096)), opts)})`
  const asserts: string[] = []
  const e = s.expect
  if (sendExpr && e) {
    if (e.send_ok === false) asserts.push(`assert not ${v}.send_result.ok  # failed when recorded`)
    else if (e.send_ok) asserts.push(`assert ${v}.send_result.ok`)
    if (e.rx_hex) asserts.push(`assert ${v}.send_result.data == ${pyBytes(e.rx_hex)}`)
  }
  if (spi !== undefined) {
    line(ctx, `with bp.open_spi(${spi}) as spi:`)
    line(ctx, IND + call)
  } else line(ctx, call)
  for (const x of asserts) line(ctx, x)
}

/** The sequence as a pytest file. */
export function sequenceToPytest(seq: Pick<BusSequence, 'name' | 'steps'>, opts: PytestOptions = {}): string {
  const names = opts.names ?? []
  const date = (opts.date ?? new Date()).toISOString().slice(0, 10)
  const sessions = seq.steps.some((s) =>
    ['i2c_open', 'i2c_transfer', 'i2c_scan', 'can_open', 'can_read', 'uart_open', 'uart_write'].includes(s.tool) ||
    (s.tool === 'capture_la' && (s.args?.send as { bus?: string } | undefined)?.bus === 'i2c'),
  )
  const ctx: Ctx = { out: [], ind: IND + (sessions ? IND : ''), names, imports: new Set(), open: new Set(), stack: sessions }
  // Version 2: the setup steps first, under a comment, then the recorded steps.
  const setup = seq.steps.some((s) => s.setup)
  seq.steps.forEach((s, i) => {
    if (setup && i === 0) line(ctx, '# Setup: the bus as it was when the sequence was recorded (opened before its first step).')
    if (setup && !s.setup && seq.steps[i - 1]?.setup) line(ctx, '# The recorded steps.')
    stepCode(ctx, s, i + 1)
  })
  if (!ctx.out.length) ctx.out.push(ctx.ind + 'pass  # the sequence has no steps')

  const sdk = ['Trigger', 'SpiSend', 'GpioSend'].filter((x) => ctx.imports.has(x))
  const head = [
    `# ${pytestFileName(seq.name)}: the bus console sequence "${seq.name.replace(/[\r\n]+/g, ' ')}", exported ${date}.`,
    '#',
    '# Runs with the embeddedci SDK and its pytest plugin (the `benchpod` fixture):',
    '#   pip install embeddedci',
    `#   pytest ${pytestFileName(seq.name)} --benchpod-connection <host, usb or embeddedci:<pod>>`,
    '#',
    '# Each read asserts what the pod saw when the sequence was recorded: edit the expected bytes',
    '# and levels to what your board should return. Channel names come from the wiring profile.',
    '',
  ]
  const imports: string[] = []
  if (ctx.imports.has('import time')) imports.push('import time')
  if (sessions) imports.push('from contextlib import ExitStack')
  if (imports.length) imports.push('')
  if (sdk.length) imports.push(`from embeddedci.benchpod import ${sdk.join(', ')}`, '')
  const body = [`def test_${slug(seq.name)}(benchpod):`, `${IND}bp = benchpod`]
  if (sessions) body.push(`${IND}with ExitStack() as stack:  # closes the sessions opened below, even when an assert fails`)
  return [...head, ...imports, '', ...body, ...ctx.out, ''].join('\n').replace(/\n{3,}/g, '\n\n\n')
}
