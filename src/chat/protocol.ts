// The chat wire protocol, as every host serves it (benchpod-desktop's chat package):
//
//   POST {base}/send     {"text"}      -> text/event-stream of ChatEvent, ends with done or error
//   POST {base}/confirm  {"id","ok"}
//   POST {base}/stop
//   POST {base}/reset
//   GET  {base}/history                -> {"messages", "running"}

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export type ToolCall = { id: string; name: string; arguments: string }

export type Message = {
  role: Role
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export type ToolResult = {
  text: string
  /** The tool's structured output, for drawing (a capture, a UART log). */
  structured?: unknown
  is_error?: boolean
}

export type Usage = { prompt_tokens: number; completion_tokens: number; cost?: number }

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; call: ToolCall; result: ToolResult; ms?: number; refused?: boolean }
  | { type: 'confirm'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'limit'; text: string }
  | { type: 'done'; usage?: Usage }
  | { type: 'error'; error: string; usage?: Usage }
  // A host's own events (the demo's quota, say) pass through untouched.
  | { type: string; [k: string]: unknown }

/** Reads `data:` frames from an event-stream body. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        try {
          yield JSON.parse(data) as ChatEvent
        } catch {
          // a frame that is not JSON is not ours: skip it
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
