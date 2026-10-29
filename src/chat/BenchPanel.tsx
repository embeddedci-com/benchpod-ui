import { useEffect, useRef, type ReactNode } from 'react'
import { Box, Group, ScrollArea, Stack, Tabs, Text, UnstyledButton } from '@mantine/core'
import type { ChatItem } from './useChat'
import { AdcEnvelope, fmtSi, isAdcCapture, type AdcCapture } from '../results/AdcEnvelope'
import { LaSummary, isLaCapture, type LaCapture } from '../results/LaSummary'
import { TerminalText } from '../results/ResultView'

// The bench panel, beside the conversation the way an editor sits beside a terminal agent: the
// board's console as one running terminal, and the captures drawn large. The transcript keeps a
// one-line summary of each and opens the panel at it.

export type ConsoleEntry = { id: string; dir: 'out' | 'in'; text: string }
export type CaptureEntry = { id: string; tool: string; title: string; adc?: AdcCapture; la?: LaCapture; decoded?: { protocol: string; text: string } }

const CONSOLE_OUT = /^(uart_read|capture_uart|power_cycle_and_capture)$/

function parseArgs(a: string): Record<string, unknown> {
  try {
    return a ? (JSON.parse(a) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The text a console tool returned: its structured `text`, or the JSON text the model read. */
function consoleText(structured: unknown, text: string): string | undefined {
  const s = structured as { text?: unknown } | undefined
  if (s && typeof s.text === 'string') return s.text
  try {
    const j = JSON.parse(text) as { text?: unknown }
    if (typeof j.text === 'string') return j.text
  } catch {
    // not JSON: not a console result
  }
  return undefined
}

/** The console and the captures in a transcript, in order. */
export function benchOutputs(items: ChatItem[]): { console: ConsoleEntry[]; captures: CaptureEntry[] } {
  const out = { console: [] as ConsoleEntry[], captures: [] as CaptureEntry[] }
  for (const it of items) {
    if (it.kind !== 'tool' || !it.result || it.result.is_error || it.refused) continue
    const name = it.call.name
    const st = it.result.structured as Record<string, unknown> | undefined
    if (name === 'uart_write') {
      const t = parseArgs(it.call.arguments).text
      if (typeof t === 'string') out.console.push({ id: it.id, dir: 'in', text: t })
      continue
    }
    if (CONSOLE_OUT.test(name)) {
      const t = consoleText(st, it.result.text)
      if (t) out.console.push({ id: it.id, dir: 'out', text: t })
      continue
    }
    if (isAdcCapture(st)) out.captures.push({ id: it.id, tool: name, title: adcTitle(st), adc: st })
    else if (isLaCapture(st)) out.captures.push({ id: it.id, tool: name, title: laTitle(st), la: st })
    else if (st && isAdcCapture(st.adc) && isLaCapture(st.la))
      out.captures.push({ id: it.id, tool: name, title: `ADC + LA · ${adcTitle(st.adc)}`, adc: st.adc, la: st.la })
    else if (st && typeof st.protocol === 'string' && Array.isArray(st.items))
      out.captures.push({
        id: it.id,
        tool: name,
        title: `${String(st.protocol).toUpperCase()} decode · ${(st.items as unknown[]).length} items`,
        decoded: { protocol: String(st.protocol), text: (st.text as string) || (st.items as string[]).join('\n') },
      })
  }
  return out
}

export function adcTitle(c: AdcCapture): string {
  const u = c.unit ?? 'V'
  return `ADC${c.source ? ' ' + c.source : ''} · ${fmtSi(c.mean, u)} · ${fmtSi(c.peak_to_peak, u)} p-p`
}

export function laTitle(c: LaCapture): string {
  const active = c.channels.filter((ch) => ch.edges > 0).length
  return `LA · ${active} active · ${fmtSi(c.duration, 's')}`
}

/** Which panel tab a tool's result goes to, or undefined when it stays in the transcript. */
export function panelKind(entry: { console: ConsoleEntry[]; captures: CaptureEntry[] }, itemId: string): 'console' | 'captures' | undefined {
  if (entry.captures.some((c) => c.id === itemId)) return 'captures'
  if (entry.console.some((c) => c.id === itemId)) return 'console'
  return undefined
}

export type PanelTab = { value: string; label: string; content: ReactNode }

export function BenchPanel({
  outputs,
  tab,
  onTab,
  selected,
  onSelect,
  extraTabs = [],
}: {
  outputs: { console: ConsoleEntry[]; captures: CaptureEntry[] }
  tab: string
  onTab: (t: string) => void
  selected?: string
  onSelect: (id: string) => void
  extraTabs?: PanelTab[]
}) {
  const consoleEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (tab === 'console') consoleEnd.current?.scrollIntoView({ block: 'end' })
  }, [tab, outputs.console.length])
  const caps = [...outputs.captures].reverse()
  const current = caps.find((c) => c.id === selected) ?? caps[0]

  return (
    <Tabs value={tab} onChange={(v) => v && onTab(v)} keepMounted={false} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Tabs.List px="xs">
        <Tabs.Tab value="console">Console{outputs.console.length ? ` (${outputs.console.length})` : ''}</Tabs.Tab>
        <Tabs.Tab value="captures">Captures{outputs.captures.length ? ` (${outputs.captures.length})` : ''}</Tabs.Tab>
        {extraTabs.map((t) => (
          <Tabs.Tab key={t.value} value={t.value}>
            {t.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <Tabs.Panel value="console" h="100%">
          <ScrollArea h="100%">
            <Box p="sm">
              {outputs.console.length === 0 ? (
                <Text size="sm" c="dimmed">
                  The board&apos;s console appears here.
                </Text>
              ) : (
                <TerminalText
                  maxHeight={100000}
                  text={outputs.console.map((e) => (e.dir === 'in' ? `\n⟶ ${e.text}\n` : e.text)).join('')}
                />
              )}
              <div ref={consoleEnd} />
            </Box>
          </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel value="captures" h="100%">
          <ScrollArea h="100%">
            <Stack p="sm" gap="sm">
              {!current ? (
                <Text size="sm" c="dimmed">
                  ADC and logic captures appear here.
                </Text>
              ) : (
                <>
                  <Text size="sm" fw={600}>
                    {current.title}
                  </Text>
                  {current.adc ? <AdcEnvelope capture={current.adc} height={240} /> : null}
                  {current.la ? <LaSummary capture={current.la} /> : null}
                  {current.decoded ? <TerminalText text={current.decoded.text} maxHeight={360} /> : null}
                  {caps.length > 1 ? (
                    <Stack gap={2} mt="xs">
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                        All captures
                      </Text>
                      {caps.map((c) => (
                        <UnstyledButton key={c.id} onClick={() => onSelect(c.id)} px={6} py={2} style={{ borderRadius: 4, background: c.id === current.id ? 'var(--mantine-color-default-hover)' : undefined }}>
                          <Group gap={6} wrap="nowrap">
                            <Text size="xs" ff="monospace" c="dimmed">
                              {c.tool}
                            </Text>
                            <Text size="xs" lineClamp={1}>
                              {c.title}
                            </Text>
                          </Group>
                        </UnstyledButton>
                      ))}
                    </Stack>
                  ) : null}
                </>
              )}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
        {extraTabs.map((t) => (
          <Tabs.Panel key={t.value} value={t.value} h="100%">
            <ScrollArea h="100%">{t.content}</ScrollArea>
          </Tabs.Panel>
        ))}
      </Box>
    </Tabs>
  )
}
