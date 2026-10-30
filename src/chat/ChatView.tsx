import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActionIcon, Alert, Anchor, Badge, Box, Button, CloseButton, Drawer, FileButton, Group, Loader, Modal, ScrollArea, Stack, Text, Textarea, Tooltip, UnstyledButton } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Markdown } from './Markdown'
import { ResultView } from '../results/ResultView'
import { ToolsList, groupTools, type ToolInfo } from './ToolsList'
import { BenchPanel, benchOutputs, panelKind, type CaptureEntry, type ConsoleEntry, type PanelTab } from './BenchPanel'
import type { ChatItem } from './useChat'
import type { ToolCall } from './protocol'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** Tools whose result is worth seeing without a click: logs and captures. */
const OPEN_BY_DEFAULT = /^(uart_read|capture_|power_cycle_and_capture|decode_la|adc_read|measure_power|i2c_sensor_capture|dac_output|generate|current_out)/

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

function ToolRow({
  item,
  onConfirm,
  inPanel,
  onOpenPanel,
}: {
  item: Extract<ChatItem, { kind: 'tool' }>
  onConfirm: (id: string, ok: boolean) => void
  /** The panel shows this result: the transcript keeps a summary line that opens it. */
  inPanel?: { kind: 'console' | 'captures' | 'power'; summary: string }
  onOpenPanel?: (kind: 'console' | 'captures' | 'power', id: string) => void
}) {
  const done = !!item.result
  const err = item.result?.is_error
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? (done && !err && !item.refused && !inPanel && OPEN_BY_DEFAULT.test(item.call.name))
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
      {inPanel && !expanded && onOpenPanel ? (
        <UnstyledButton onClick={() => onOpenPanel(inPanel.kind, item.id)} ml={16} mt={2} style={{ display: 'block' }}>
          <Text size="xs" ff={MONO} c="blue" lineClamp={1}>
            ⎿ {inPanel.summary} ↗
          </Text>
        </UnstyledButton>
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
  /** Put the cursor in the composer on arrival (wide screens: a phone would pop its keyboard). */
  autoFocus?: boolean
  /** Set to block sending, with the reason shown in place of the composer hint. */
  disabledReason?: string
  /** Height of the whole view; defaults to filling its parent. */
  height?: number | string
  /** The tools the agent may use (useTools): listed while the conversation is empty, and
   *  behind an "N tools" button next to the composer. */
  tools?: ToolInfo[] | null
  /** The full tool reference (parameters, units, defaults), linked under the tools list. */
  toolsReferenceHref?: string
  /** A "Help" link beside the message box: how to use the agent. */
  helpHref?: string
  /** The bench panel beside the conversation (console, captures). On by default. */
  panel?: boolean
  /** More panel tabs from the host (the demo's "About"). */
  panelTabs?: PanelTab[]
  /** Files attached to this conversation, shown above the message box. */
  attachments?: { name: string; size: number }[]
  /** Offers a paperclip beside the message box. */
  onAttach?: (file: File) => void
  onDetach?: (name: string) => void
  /** Which files the paperclip offers, e.g. ".elf,.hex,.bin". */
  attachAccept?: string
  /** A file is on its way up. */
  attaching?: boolean
  /** The panel's tab before there is any output (default: the console). The panel starts open on a wide screen. */
  panelInitialTab?: string
}

/** A small line icon (24x24 path), in the current text color. */
function Icon({ d }: { d: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

function consoleSummary(e: ConsoleEntry): string {
  if (e.dir === 'in') return `typed "${e.text.trim()}"`
  const lines = e.text.split('\n').filter((l) => l.trim()).length
  return `${lines} console line${lines === 1 ? '' : 's'}`
}

/** The agent conversation: transcript, tool calls with their results, and the composer. */
export function ChatView(p: ChatViewProps) {
  const [draft, setDraft] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const panelOn = p.panel !== false
  // Read synchronously: a phone must never see the panel open itself on the first render.
  const wide = useMediaQuery('(min-width: 62em)', false, { getInitialValueInEffect: false })
  const outputs = useMemo(() => benchOutputs(p.items), [p.items])
  const [panelOpen, setPanelOpen] = useState(wide)
  const [panelTab, setPanelTab] = useState(p.panelInitialTab ?? 'console')
  const [selected, setSelected] = useState<string | undefined>()
  const seen = useRef({ console: 0, captures: 0, power: 0 })
  // The panel starts open beside the conversation (a phone opens its drawer by hand). It moves to
  // the newest capture or power reading as they come, and to the console on its first output.
  useEffect(() => {
    if (!panelOn) return
    if (p.items.length === 0) {
      // A new conversation starts like a fresh visit.
      seen.current = { console: 0, captures: 0, power: 0 }
      setPanelTab(p.panelInitialTab ?? 'console')
      setPanelOpen(wide)
      return
    }
    const c = outputs.console.length
    const k = outputs.captures.length
    const w = outputs.power.length
    if (k > seen.current.captures) {
      setPanelTab('captures')
      setSelected(outputs.captures[k - 1].id)
    } else if (w > seen.current.power) {
      setPanelTab('power')
      setSelected(outputs.power[w - 1].id)
    } else if (c > seen.current.console && seen.current.console === 0 && seen.current.captures === 0) {
      setPanelTab('console')
    }
    seen.current = { console: c, captures: k, power: w }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputs, panelOn, wide])
  const openPanel = (kind: 'console' | 'captures' | 'power', id: string) => {
    setPanelTab(kind)
    if (kind !== 'console') setSelected(id)
    setPanelOpen(true)
  }
  const inPanel = (id: string): { kind: 'console' | 'captures' | 'power'; summary: string } | undefined => {
    if (!panelOn) return undefined
    const kind = panelKind(outputs, id)
    if (kind === 'power') return { kind, summary: outputs.power.find((c) => c.id === id)?.title ?? '' }
    if (kind === 'captures') return { kind, summary: (outputs.captures.find((c) => c.id === id) as CaptureEntry).title }
    if (kind === 'console') return { kind, summary: consoleSummary(outputs.console.find((c) => c.id === id) as ConsoleEntry) }
    return undefined
  }
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // Follow the conversation to its end unless the reader scrolled up. Content grows without a
  // new item too (a capture drawing, a tool result opening), so a resize observer follows it,
  // and only the reader's own scrolling (wheel, touch, keys) can stop the following.
  const stick = useRef(true)
  // An empty conversation opens at the top (the intro, the examples, the tools); following
  // starts with the first message.
  const hasItems = useRef(false)
  hasItems.current = p.items.length > 0

  useEffect(() => {
    const v = viewport.current
    const c = content.current
    if (!v || !c) return
    const toEnd = () => {
      if (stick.current && hasItems.current) v.scrollTop = v.scrollHeight
    }
    const ro = new ResizeObserver(toEnd)
    ro.observe(c)
    const userScrolled = () => {
      requestAnimationFrame(() => {
        stick.current = v.scrollHeight - v.scrollTop - v.clientHeight < 40
      })
    }
    v.addEventListener('wheel', userScrolled, { passive: true })
    v.addEventListener('touchmove', userScrolled, { passive: true })
    v.addEventListener('keydown', userScrolled)
    return () => {
      ro.disconnect()
      v.removeEventListener('wheel', userScrolled)
      v.removeEventListener('touchmove', userScrolled)
      v.removeEventListener('keydown', userScrolled)
    }
  }, [])

  useEffect(() => {
    const v = viewport.current
    if (!v) return
    if (p.items.length === 0) v.scrollTop = 0
    else if (stick.current) v.scrollTop = v.scrollHeight
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

  const panel = (
    <BenchPanel
      outputs={outputs}
      tab={panelTab}
      onTab={setPanelTab}
      selected={selected}
      onSelect={setSelected}
      extraTabs={p.panelTabs}
    />
  )

  return (
    <Group gap={0} wrap="nowrap" align="stretch" h={p.height ?? '100%'} style={{ minHeight: 0 }}>
    <Stack gap={0} h="100%" style={{ minHeight: 0, flex: 1, minWidth: 0 }}>
      <style>{`@keyframes bpui-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }`}</style>
      <ScrollArea
        viewportRef={viewport}
        style={{ flex: 1, minHeight: 0 }}
      >
        <Stack ref={content} gap="sm" p="md" maw={920} mx="auto">
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
              {p.tools?.length ? (
                <Text size="sm" c="dimmed">
                  {p.tools.length} BenchPod tools: {groupTools(p.tools).map((g) => g.title).join(' · ')}.{' '}
                  <Anchor component="button" size="sm" onClick={() => setToolsOpen(true)}>
                    See all
                  </Anchor>
                </Text>
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
                return <ToolRow key={it.id} item={it} onConfirm={p.onConfirm} inPanel={inPanel(it.id)} onOpenPanel={openPanel} />
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
      <Box px="md" pb="sm" pt={4}>
        <Box maw={920} mx="auto">
          {p.attachments?.length ? (
            <Group gap={6} mb={6}>
              {p.attachments.map((a) => (
                <Badge
                  key={a.name}
                  variant="light"
                  color="gray"
                  tt="none"
                  rightSection={
                    p.onDetach ? (
                      <CloseButton size={14} aria-label={`Remove ${a.name}`} onClick={() => p.onDetach?.(a.name)} />
                    ) : undefined
                  }
                >
                  {a.name}
                </Badge>
              ))}
            </Group>
          ) : null}
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <Textarea
              style={{ flex: 1 }}
              autosize
              autoFocus={p.autoFocus && wide}
              size="md"
              radius="md"
              minRows={2}
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
          {p.footer || p.tools?.length || p.helpHref || p.onAttach ? (
            <Group mt={6} gap={4} align="center" wrap="nowrap">
              {p.onAttach ? (
                <FileButton
                  accept={p.attachAccept}
                  onChange={(f) => {
                    if (f) p.onAttach?.(f)
                  }}
                >
                  {(props) => (
                    <Tooltip label="Attach a firmware file">
                      <ActionIcon {...props} variant="subtle" size="sm" loading={p.attaching} disabled={!!p.disabledReason} aria-label="Attach a file">
                        <Icon d="M21 11.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </FileButton>
              ) : null}
              {p.tools?.length ? (
                <Tooltip label={`The agent's ${p.tools.length} BenchPod tools`}>
                  <ActionIcon variant="subtle" size="sm" onClick={() => setToolsOpen(true)} aria-label="Tools">
                    <Icon d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              {panelOn ? (
                <Tooltip label={panelOpen ? 'Hide the console and captures' : 'Show the console and captures'}>
                  <ActionIcon variant={panelOpen ? 'light' : 'subtle'} size="sm" onClick={() => setPanelOpen(!panelOpen)} aria-label="Bench panel">
                    <Icon d="M4 4h16v16H4zM14 4v16" />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              {p.helpHref ? (
                <Tooltip label="How to use the agent">
                  <ActionIcon variant="subtle" size="sm" component="a" href={p.helpHref} target="_blank" rel="noopener" aria-label="Help">
                    <Icon d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5" />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              <Box style={{ flex: 1, minWidth: 0 }}>{p.footer}</Box>
            </Group>
          ) : null}
        </Box>
      </Box>
      <Modal opened={toolsOpen} onClose={() => setToolsOpen(false)} title={`The agent's ${p.tools?.length ?? 0} BenchPod tools`} size="xl">
        {p.tools ? <ToolsList tools={p.tools} referenceHref={p.toolsReferenceHref} /> : null}
      </Modal>
    </Stack>
      {panelOn && panelOpen && wide ? (
        <Box style={{ width: '44%', minWidth: 340, maxWidth: 720, flex: 'none', borderLeft: '1px solid var(--mantine-color-default-border)', minHeight: 0 }}>
          {panel}
        </Box>
      ) : null}
      {panelOn && !wide ? (
        <Drawer
          opened={panelOpen}
          onClose={() => setPanelOpen(false)}
          position="right"
          size="100%"
          title="Bench"
          styles={{ content: { background: 'var(--mantine-color-body)' }, body: { height: 'calc(100% - 60px)' } }}
        >
          {panel}
        </Drawer>
      ) : null}
    </Group>
  )
}
