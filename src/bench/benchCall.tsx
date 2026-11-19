import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Group, Modal, Stack, Text } from '@mantine/core'

// The bench controls (power, console, captures, outputs) call the BenchPod MCP tools by hand,
// through the host's tool endpoint, which applies the same policy as the agent:
//
//   POST {base}/{tool}  {"args": {...}, "confirmed": false, "poll": false}
//     -> {"text", "structured", "is_error", "refused", "confirm", "ms"}
//
// confirm=true means the call did not run: it waits for the user's yes. useBenchCall asks, and
// sends it again with confirmed=true. poll marks a repeated read the host need not log.

export type BenchResult = {
  text: string
  structured?: unknown
  is_error?: boolean
  /** Not run: not allowed here, or above a bench limit. */
  refused?: boolean
  /** Not run: waits for the user's yes. */
  confirm?: boolean
  /** The user said no. */
  declined?: boolean
  ms?: number
}

export type BenchCallOptions = {
  poll?: boolean
  signal?: AbortSignal
  /**
   * The user already said yes to this call as part of a batch (device mode "Read all", a saved
   * sequence step after the first): send it confirmed, without a dialog of its own.
   */
  approved?: boolean
}

/** Runs one tool by hand. Resolves with the result; a refusal or tool error is a result, not a throw. */
export type BenchCall = (tool: string, args?: Record<string, unknown>, opts?: BenchCallOptions) => Promise<BenchResult>

/** The text of a failed result for a page to show. */
export function benchError(r: BenchResult): string | undefined {
  if (r.declined) return undefined
  return r.is_error || r.refused ? r.text || 'the call failed' : undefined
}

/** The structured result, or the JSON the text holds. */
export function benchData<T>(r: BenchResult): T | undefined {
  if (r.is_error || r.refused || r.confirm || r.declined) return undefined
  if (r.structured !== undefined) return r.structured as T
  try {
    return JSON.parse(r.text) as T
  } catch {
    return undefined
  }
}

/** Arguments holding an address or id, shown in hex. */
const HEX_KEYS = new Set(['addr', 'address', 'reg', 'can_id', 'id', 'mask'])
/** Arguments holding bytes, shown as hex bytes. */
const BYTE_KEYS = new Set(['data', 'bytes', 'write', 'tx'])

const hex = (n: number, w = 2) => '0x' + n.toString(16).toUpperCase().padStart(w, '0')

/** The confirm dialog's lines: every argument in full, addresses and bytes in hex. */
export function confirmLines(args: Record<string, unknown>): [string, string][] {
  return Object.entries(args).map(([k, v]) => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && HEX_KEYS.has(k)) return [k, `${hex(v)} (${v})`]
    if (Array.isArray(v) && BYTE_KEYS.has(k) && v.every((x) => typeof x === 'number')) {
      return [k, v.length ? v.map((x) => (x as number).toString(16).toUpperCase().padStart(2, '0')).join(' ') : '(none)']
    }
    if (typeof v === 'string') return [k, v]
    return [k, JSON.stringify(v)]
  })
}

const las = (v: unknown): string => {
  const list = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'number') as number[]
  return list.length ? list.map((n) => `LA${n}`).join(list.length === 2 ? ' and ' : ', ') : 'the pins'
}
/** set_pull's direction: pull ("up" / "down" / "off"), else the older enabled flag. */
const pullOf = (a: Record<string, unknown>): string => (typeof a.pull === 'string' ? a.pull : a.enabled === false ? 'off' : 'up')
const addr = (v: unknown): string => (typeof v === 'number' ? hex(v) : String(v ?? ''))

/**
 * One plain sentence for a call the pod asks to confirm, for the tools people click by hand. Null
 * for the rest: the dialog then lists the arguments.
 */
export function describeCall(tool: string, a: Record<string, unknown>): string | null {
  switch (tool) {
    case 'set_pull':
      return pullOf(a) === 'off'
        ? `Switch off the pull resistors on ${las(a.las ?? a.la)}?`
        : `Pull ${las(a.las ?? a.la)} ${pullOf(a) === 'down' ? 'down' : 'up'}?`
    case 'i2c_open':
      return `Open I2C on ${las(a.sda)} (SDA) and ${las(a.scl)} (SCL)${typeof a.hz === 'number' ? ` at ${a.hz / 1000} kHz` : ''}?`
    case 'i2c_close':
      return 'Close the I2C session?'
    case 'i2c_scan':
      return 'Scan the I2C bus for devices?'
    case 'i2c_transfer':
      return `Send an I2C transfer to ${addr(a.addr)}?`
    case 'spi_transfer':
      return 'Send an SPI transfer?'
    case 'gpio_mode':
      return `Set ${las(a.la)} to ${String(a.mode ?? 'a new mode').replace('_', ' ')}?`
    case 'gpio_write':
      return `Drive ${las(a.la)} ${a.value === 1 || a.value === true ? 'high' : 'low'}?`
    case 'gpio_pulse':
      return `Pulse ${las(a.la)}?`
    case 'gpio_release':
      return `Release ${las(a.la)}?`
    case 'can_open':
      return 'Join the CAN bus?'
    case 'can_write':
      return `Send a CAN frame${a.id != null ? ` with id ${addr(a.id)}` : ''}?`
    case 'uart_write':
      return "Send this to the board's UART?"
    case 'flash': {
      const file = String(a.file ?? '').split(/[\\/]/).pop() || 'the image'
      const t = String(a.target ?? '')
      return /^esp32/i.test(t) ? `Flash ${file} to the ${t.toUpperCase()} over its UART?` : `Flash ${file} to the board over SWD?`
    }
    case 'power_cycle_and_capture':
      return "Power-cycle the board and capture its console?"
    case 'save_wiring':
      return `Save the pins profile${a.name ? ` ${String(a.name)}` : ''} to the pod?`
    case 'load_wiring':
      return `Use the pins profile ${String(a.name ?? '')} in this session?`
    case 'delete_wiring':
      return `Delete the pins profile ${String(a.name ?? '')} from the pod?`
    case 'set_default_wiring':
      return `Make ${String(a.name ?? '')} the active pins profile?`
    case 'power_on':
      return 'Turn on target power?'
    case 'power_off':
      return 'Turn off target power?'
    default:
      return null
  }
}

async function post(base: string, tool: string, args: Record<string, unknown>, confirmed: boolean, opts?: BenchCallOptions): Promise<BenchResult> {
  const r = await fetch(`${base}/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args, confirmed, poll: !!opts?.poll }),
    signal: opts?.signal,
  })
  if (!r.ok) return { text: (await r.text()).trim() || `HTTP ${r.status}`, is_error: true }
  return (await r.json()) as BenchResult
}

/** A call that waits for the user's yes, and how to answer it. */
type Pending = { tool: string; args: Record<string, unknown>; resolve: (ok: boolean) => void }

/**
 * The confirm dialog's state, outside React: asking re-renders only the dialog, not the page that
 * holds the BenchCall (a whole workspace, which made the dialog late on a busy page).
 */
export type ConfirmStore = {
  /** Shows the dialog for this call; resolves with the user's answer. A new ask declines the old one. */
  ask(tool: string, args: Record<string, unknown>): Promise<boolean>
  get(): Pending | null
  subscribe(fn: () => void): () => void
  answer(ok: boolean): void
}

export function createConfirmStore(): ConfirmStore {
  let pending: Pending | null = null
  const subs = new Set<() => void>()
  const set = (p: Pending | null) => {
    pending = p
    for (const f of subs) f()
  }
  return {
    ask: (tool, args) =>
      new Promise<boolean>((resolve) => {
        pending?.resolve(false)
        set({ tool, args, resolve })
      }),
    get: () => pending,
    subscribe: (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    answer: (ok) => {
      const p = pending
      set(null)
      p?.resolve(ok)
    },
  }
}

/** The call's raw tool and arguments, folded away when a sentence says what it does. */
function Details({ open, children }: { open: boolean; children: ReactNode }) {
  if (open) return <>{children}</>
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)' }}>Details</summary>
      {children}
    </details>
  )
}

/** The confirmation dialog for a ConfirmStore: a sentence, or the raw call. Render it once in the page. */
export function ConfirmDialog({ store }: { store: ConfirmStore }) {
  const pending = useSyncExternalStore(store.subscribe, store.get, store.get)
  return (
    <Modal opened={!!pending} onClose={() => store.answer(false)} title="Run this on the pod?" centered size="md">
      {pending ? (
        <Stack gap="md">
          {describeCall(pending.tool, pending.args) ? <Text size="sm">{describeCall(pending.tool, pending.args)}</Text> : null}
          <Details open={!describeCall(pending.tool, pending.args)}>
            <Stack gap={2}>
              <Text size="sm" fw={600} ff="monospace">
                {pending.tool}
              </Text>
              {confirmLines(pending.args).map(([k, v]) => (
                <Text key={k} size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                  <Text span c="dimmed" ff="monospace" inherit>
                    {k}:
                  </Text>{' '}
                  {v}
                </Text>
              ))}
            </Stack>
          </Details>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => store.answer(false)}>
              Cancel
            </Button>
            <Button onClick={() => store.answer(true)} data-autofocus>
              Run it
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  )
}

/**
 * A BenchCall against the host's tool endpoint, and the dialog that asks before a risky call.
 * Render `dialog` once in the page.
 */
export function useBenchCall(base: string): { call: BenchCall; dialog: ReactNode } {
  const store = useMemo(createConfirmStore, [])

  const call = useCallback<BenchCall>(
    async (tool, args = {}, opts) => {
      try {
        if (opts?.approved) return await post(base, tool, args, true, opts)
        const first = await post(base, tool, args, false, opts)
        if (!first.confirm) return first
        const ok = await store.ask(tool, args)
        if (!ok) return { text: 'not run: you declined it', declined: true }
        return await post(base, tool, args, true, opts)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return { text: 'stopped', declined: true }
        return { text: (e as Error).message, is_error: true }
      }
    },
    [base, store],
  )

  return { call, dialog: <ConfirmDialog store={store} /> }
}
