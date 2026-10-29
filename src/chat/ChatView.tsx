import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActionIcon, Alert, Box, Button, Group, Loader, ScrollArea, Stack, Text, Textarea, UnstyledButton } from '@mantine/core'
import { Markdown } from './Markdown'
import { ResultView } from '../results/ResultView'
import type { ChatItem } from './useChat'
import type { ToolCall } from './protocol'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** Tools whose result is worth seeing without a click: logs and captures. */
const OPEN_BY_DEFAULT = /^(uart_read|capture_|power_cycle_and_capture|decode_la|adc_read|measure_power|i2c_sensor_capture)/

/** "name(arg: value, …)" with long values cut, the way a terminal agent prints a call. */
export function callSummary(call: ToolCall, max = 90): string {
  let args: Record<string, unknown> = {}
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {}
  } catch {
    return `${call.name}(…)`
  }
  const parts = Object.entries(args).map(([k, v]) => {
    let s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)
    if (s && s.length > 40) s = s.slice(0, 37) + '…'
    return `${k}: ${s}`
  })
  const inner = parts.join(', ')
  return `${call.name}(${inner.length > max ? inner.slice(0, max - 1) + '…' : inner})`
}

function ToolRow({ item, onConfirm }: { item: Extract<ChatItem, { kind: 'tool' }>; onConfirm: (id: string, ok: boolean) => void }) {
  const done = !!item.result
  const err = item.result?.is_error
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? (done && !err && !item.refused && OPEN_BY_DEFAULT.test(item.call.name))
  const dot = item.confirming
    ? 'var(--mantine-color-yellow-5)'
    : !done
      ? 'var(--mantine-color-blue-4)'
      : item.refused
        ? 'var(--mantine-color-gray-6)'
        : err
          ? 'var(--mantine-color-red-6)'
          : 'var(--mantine-color-green-6)'
  return (
    <Box>
      <UnstyledButton onClick={() => done && setOpen(!expanded)} style={{ display: 'block', width: '100%', cursor: done ? 'pointer' : 'default' }}>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <Box
            mt={6}
            style={{
              width: 8,
              height: 8,
              borderRadius: 8,
              flex: 'none',
              background: dot,
              animation: !done && !item.confirming ? 'bpui-pulse 1s ease-in-out infinite' : undefined,
            }}
          />
          <Text size="sm" ff={MONO} style={{ flex: 1, wordBreak: 'break-all' }}>
            {callSummary(item.call)}
          </Text>
          {done && item.ms != null ? (
            <Text size="xs" c="dimmed" ff={MONO} style={{ flex: 'none' }}>
              {item.ms < 1000 ? `${item.ms} ms` : `${(item.ms / 1000).toFixed(1)} s`}
            </Text>
          ) : null}
        </Group>
      </UnstyledButton>
      {item.confirming ? (
        <Group gap="xs" ml={16} mt={6}>
          <Text size="xs" c="yellow">
            Allow this call on the hardware?
          </Text>
          <Button size="compact-xs" color="green" onClick={() => onConfirm(item.call.id, true)}>
            Allow
          </Button>
          <Button size="compact-xs" variant="default" onClick={() => onConfirm(item.call.id, false)}>
            Deny
          </Button>
        </Group>
      ) : null}
      {done && (err || item.refused) && !expanded ? (
        <Text size="xs" c={item.refused ? 'dimmed' : 'red'} ml={16} ff={MONO} lineClamp={2}>
          ⎿ {item.result!.text}
        </Text>
      ) : null}
      {expanded && item.result ? (
        <Box ml={16} mt={4} mb={4}>
          <ResultView tool={item.call.name} structured={item.result.structured} text={item.result.text} />
        </Box>
      ) : null}
    </Box>
  )
}

export type ChatViewProps = {
  items: ChatItem[]
  running: boolean
  onSend: (text: string) => void
  onStop: () => void
  onConfirm: (id: string, ok: boolean) => void
  /** Example prompts shown while the conversation is empty. */
  suggestions?: string[]
  /** Shown above the transcript while it is empty (what this is, what it can do). */
  intro?: ReactNode
  /** Below the composer: which model, where the data goes, the usage. */
  footer?: ReactNode
  placeholder?: string
  /** Set to block sending, with the reason shown in place of the composer hint. */
  disabledReason?: string
  /** Height of the whole view; defaults to filling its parent. */
  height?: number | string
}

/** The agent conversation: transcript, tool calls with their results, and the composer. */
export function ChatView(p: ChatViewProps) {
  const [draft, setDraft] = useState('')
  const viewport = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const v = viewport.current
    if (v && stick.current) v.scrollTo({ top: v.scrollHeight })
  }, [p.items])

  const submit = () => {
    const t = draft.trim()
    if (!t || p.running || p.disabledReason) return
    stick.current = true
    p.onSend(t)
    setDraft('')
  }

  const lastIsTool = p.items[p.items.length - 1]?.kind === 'tool'
  const thinking = p.running && !lastIsTool && p.items[p.items.length - 1]?.kind !== 'assistant'

  return (
    <Stack gap={0} h={p.height ?? '100%'} style={{ minHeight: 0 }}>
      <style>{`@keyframes bpui-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }`}</style>
      <ScrollArea
        viewportRef={viewport}
        style={{ flex: 1, minHeight: 0 }}
        onScrollPositionChange={({ y }) => {
          const v = viewport.current
          if (v) stick.current = v.scrollHeight - y - v.clientHeight < 40
        }}
      >
        <Stack gap="sm" p="md" maw={920} mx="auto">
          {p.items.length === 0 ? (
            <Stack gap="md" py="lg">
              {p.intro}
              {p.suggestions?.length ? (
                <Stack gap={6}>
                  {p.suggestions.map((s) => (
                    <UnstyledButton
                      key={s}
                      onClick={() => !p.disabledReason && p.onSend(s)}
                      style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, padding: '8px 12px' }}
                    >
                      <Text size="sm" ff={MONO}>
                        › {s}
                      </Text>
                    </UnstyledButton>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
          {p.items.map((it) => {
            switch (it.kind) {
              case 'user':
                return (
                  <Box key={it.id} px="sm" py={6} style={{ borderLeft: '2px solid var(--mantine-color-dimmed)', background: 'var(--mantine-color-default-hover)', borderRadius: 4 }}>
                    <Text size="sm" ff={MONO} style={{ whiteSpace: 'pre-wrap' }}>
                      › {it.text}
                    </Text>
                  </Box>
                )
              case 'assistant':
                return (
                  <Box key={it.id}>
                    <Markdown text={it.text} />
                  </Box>
                )
              case 'tool':
                return <ToolRow key={it.id} item={it} onConfirm={p.onConfirm} />
              case 'notice':
                return (
                  <Alert key={it.id} color={it.level === 'error' ? 'red' : it.level === 'warning' ? 'yellow' : 'gray'} variant="light" p="xs">
                    <Text size="sm">{it.text}</Text>
                  </Alert>
                )
            }
          })}
          {thinking ? (
            <Group gap={8}>
              <Loader size={12} type="dots" />
              <Text size="xs" c="dimmed" ff={MONO}>
                thinking…
              </Text>
            </Group>
          ) : null}
        </Stack>
      </ScrollArea>
      <Box p="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Box maw={920} mx="auto">
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <Textarea
              style={{ flex: 1 }}
              autosize
              minRows={1}
              maxRows={8}
              value={draft}
              placeholder={p.disabledReason ?? p.placeholder ?? 'Ask the agent to test or debug your board…'}
              disabled={!!p.disabledReason}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              styles={{ input: { fontFamily: MONO, fontSize: 14 } }}
            />
            {p.running ? (
              <ActionIcon size={36} variant="default" onClick={p.onStop} aria-label="Stop">
                ■
              </ActionIcon>
            ) : (
              <ActionIcon size={36} onClick={submit} disabled={!draft.trim() || !!p.disabledReason} aria-label="Send">
                ↑
              </ActionIcon>
            )}
          </Group>
          {p.footer ? <Box mt={6}>{p.footer}</Box> : null}
        </Box>
      </Box>
    </Stack>
  )
}
