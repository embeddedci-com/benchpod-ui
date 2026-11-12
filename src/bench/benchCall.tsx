import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { callSummary } from '../chat/ChatView'

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

export type BenchCallOptions = { poll?: boolean; signal?: AbortSignal }

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

/**
 * A BenchCall against the host's tool endpoint, and the dialog that asks before a risky call.
 * Render `dialog` once in the page.
 */
export function useBenchCall(base: string): { call: BenchCall; dialog: ReactNode } {
  const [pending, setPending] = useState<{ tool: string; args: Record<string, unknown> } | null>(null)
  const answer = useRef<((ok: boolean) => void) | null>(null)

  const call = useCallback<BenchCall>(
    async (tool, args = {}, opts) => {
      try {
        const first = await post(base, tool, args, false, opts)
        if (!first.confirm) return first
        const ok = await new Promise<boolean>((resolve) => {
          answer.current?.(false)
          answer.current = resolve
          setPending({ tool, args })
        })
        if (!ok) return { text: 'not run: you declined it', declined: true }
        return await post(base, tool, args, true, opts)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return { text: 'stopped', declined: true }
        return { text: (e as Error).message, is_error: true }
      }
    },
    [base],
  )

  const close = (ok: boolean) => {
    answer.current?.(ok)
    answer.current = null
    setPending(null)
  }

  const dialog = (
    <Modal opened={!!pending} onClose={() => close(false)} title="Change the hardware?" centered size="md">
      {pending ? (
        <Stack gap="md">
          <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
            {callSummary({ id: '', name: pending.tool, arguments: JSON.stringify(pending.args) }, 300)}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={() => close(true)} data-autofocus>
              Run it
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  )

  return { call, dialog }
}
