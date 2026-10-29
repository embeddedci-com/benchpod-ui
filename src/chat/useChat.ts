import { useCallback, useEffect, useRef, useState } from 'react'
import { readEvents, type ChatEvent, type Message, type ToolCall, type ToolResult, type Usage } from './protocol'

/** One row of the transcript. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      call: ToolCall
      result?: ToolResult
      ms?: number
      refused?: boolean
      /** Waiting for the user's yes or no. */
      confirming?: boolean
    }
  | { kind: 'notice'; id: string; level: 'info' | 'warning' | 'error'; text: string }

export type UseChatOptions = {
  /** Where the protocol is served, e.g. "/api/chat". */
  base: string
  /** Extra request headers (a host's auth or a demo session id). */
  headers?: () => Record<string, string>
  /** Extra fields for the send body (the model a host lets the user pick). */
  extraBody?: () => Record<string, unknown>
  /** Every event, before the hook handles it: for a host's own event types. */
  onEvent?: (e: ChatEvent) => void
  /** Load the saved conversation on mount (default true). */
  loadHistory?: boolean
}

let seq = 0
const nextId = () => `i${++seq}`

/** The transcript of a saved conversation. Structured results are not kept in history. */
export function itemsFromHistory(messages: Message[]): ChatItem[] {
  const items: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  for (const m of messages) {
    if (m.role === 'user') items.push({ kind: 'user', id: nextId(), text: m.content })
    else if (m.role === 'assistant') {
      if (m.content) items.push({ kind: 'assistant', id: nextId(), text: m.content })
      for (const c of m.tool_calls ?? []) {
        const t = { kind: 'tool' as const, id: nextId(), call: c }
        tools.set(c.id, t)
        items.push(t)
      }
    } else if (m.role === 'tool' && m.tool_call_id) {
      const t = tools.get(m.tool_call_id)
      if (t) t.result = { text: m.content, is_error: /^(not run|refused|tool error)/.test(m.content) }
    }
  }
  return items
}

/** Applies one event to the transcript. Pure, so it is easy to test. */
export function applyEvent(items: ChatItem[], e: ChatEvent): ChatItem[] {
  switch (e.type) {
    case 'text': {
      const last = items[items.length - 1]
      const text = (e as { text: string }).text
      if (last?.kind === 'assistant') return [...items.slice(0, -1), { ...last, text: last.text + text }]
      return [...items, { kind: 'assistant', id: nextId(), text }]
    }
    case 'tool_call': {
      const call = (e as { call: ToolCall }).call
      return [...items, { kind: 'tool', id: nextId(), call }]
    }
    case 'confirm':
    case 'tool_result': {
      const ev = e as { call: ToolCall; result?: ToolResult; ms?: number; refused?: boolean }
      // The latest row for this call id: ids repeat across runs with some local models.
      let idx = -1
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.kind === 'tool' && it.call.id === ev.call.id) {
          idx = i
          break
        }
      }
      if (idx < 0) return items
      const row = items[idx] as Extract<ChatItem, { kind: 'tool' }>
      const next: ChatItem =
        e.type === 'confirm'
          ? { ...row, confirming: true }
          : { ...row, confirming: false, result: ev.result, ms: ev.ms, refused: ev.refused }
      return [...items.slice(0, idx), next, ...items.slice(idx + 1)]
    }
    case 'limit':
      return [...items, { kind: 'notice', id: nextId(), level: 'warning', text: (e as { text: string }).text }]
    case 'error': {
      const err = (e as { error: string }).error
      if (err === 'stopped') return [...items, { kind: 'notice', id: nextId(), level: 'info', text: 'Stopped.' }]
      return [...items, { kind: 'notice', id: nextId(), level: 'error', text: err }]
    }
    default:
      return items
  }
}

export function useChat(opts: UseChatOptions) {
  const { base, loadHistory = true } = opts
  const [items, setItems] = useState<ChatItem[]>([])
  const [running, setRunning] = useState(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const abortRef = useRef<AbortController | null>(null)

  const headers = useCallback(
    (json: boolean): Record<string, string> => ({
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(optsRef.current.headers?.() ?? {}),
    }),
    [],
  )

  const reload = useCallback(async () => {
    const r = await fetch(`${base}/history`, { headers: headers(false), credentials: 'same-origin' })
    if (!r.ok) return
    const body = (await r.json()) as { messages: Message[]; running: boolean }
    setItems(itemsFromHistory(body.messages ?? []))
    setRunning(body.running)
  }, [base, headers])

  useEffect(() => {
    if (loadHistory) void reload().catch(() => {})
  }, [loadHistory, reload])

  const send = useCallback(
    async (text: string) => {
      const t = text.trim()
      if (!t || abortRef.current) return
      const ac = new AbortController()
      abortRef.current = ac
      setRunning(true)
      setItems((prev) => [...prev, { kind: 'user', id: nextId(), text: t }])
      try {
        const r = await fetch(`${base}/send`, {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({ ...(optsRef.current.extraBody?.() ?? {}), text: t }),
          credentials: 'same-origin',
          signal: ac.signal,
        })
        if (!r.ok || !r.body) {
          const msg = (await r.text().catch(() => '')).trim() || `HTTP ${r.status}`
          optsRef.current.onEvent?.({ type: 'http_error', status: r.status, error: msg })
          setItems((prev) => [...prev, { kind: 'notice', id: nextId(), level: 'error', text: msg }])
          return
        }
        for await (const e of readEvents(r.body)) {
          optsRef.current.onEvent?.(e)
          if (e.type === 'usage' || e.type === 'done') {
            const u = (e as { usage?: Usage }).usage
            if (u) setUsage(u)
          }
          setItems((prev) => applyEvent(prev, e))
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          setItems((prev) => [...prev, { kind: 'notice', id: nextId(), level: 'error', text: String(err) }])
        }
      } finally {
        abortRef.current = null
        setRunning(false)
      }
    },
    [base, headers],
  )

  const post = useCallback(
    (path: string, body?: unknown) =>
      fetch(`${base}/${path}`, {
        method: 'POST',
        headers: headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      }),
    [base, headers],
  )

  const confirm = useCallback(
    async (id: string, ok: boolean) => {
      setItems((prev) => prev.map((it) => (it.kind === 'tool' && it.call.id === id ? { ...it, confirming: false } : it)))
      await post('confirm', { id, ok })
    },
    [post],
  )

  const stop = useCallback(async () => {
    await post('stop')
  }, [post])

  const reset = useCallback(async () => {
    const r = await post('reset')
    if (r.ok) {
      setItems([])
      setUsage(null)
    }
  }, [post])

  return { items, running, usage, send, stop, confirm, reset, reload, setItems }
}
