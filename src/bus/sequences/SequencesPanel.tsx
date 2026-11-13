import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Menu, Modal, Paper, Stack, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import type { BenchCall } from '../../bench/benchCall'
import { SEQUENCE_VERSION, type BusSequence, type SequenceStep, type SequenceStore } from './model'
import { pytestFileName, sequenceToPytest } from './pytest'
import { runSequence, type StepOutcome } from './run'

// Saved sequences of the bus console: save the log rows the user selected under a name, run a
// sequence again (each step through the host's BenchCall, so the same confirmations apply), and
// export it as a pytest file. Where sequences are kept is the host's SequenceStore: embeddedci.com
// (per user, shareable in the organization) or a local file in the desktop app.

const OUTCOME: Record<StepOutcome['status'], { label: string; color: string }> = {
  ok: { label: 'OK', color: 'teal' },
  differs: { label: 'differs', color: 'orange' },
  error: { label: 'error', color: 'red' },
  declined: { label: 'not run', color: 'gray' },
  skipped: { label: 'skipped', color: 'gray' },
}

/** One line per step for the lists: the tool and its main arguments. */
export function stepLabel(s: SequenceStep): string {
  const a = s.args ?? {}
  const hex = (v: unknown) => String(v ?? '').replace(/\s+/g, '').match(/../g)?.join(' ') ?? ''
  const addr = (v: unknown) => `0x${Number(v).toString(16).padStart(2, '0')}`
  switch (s.tool) {
    case 'i2c_transfer':
      return `I2C ${addr(a.addr)}${a.write_hex ? ` W ${hex(a.write_hex)}` : ''}${Number(a.read) ? ` R ${a.read}` : ''}`
    case 'i2c_scan':
      return 'I2C scan'
    case 'i2c_open':
      return `I2C open${a.hz ? ` ${Number(a.hz) / 1000} kHz` : ''}`
    case 'i2c_close':
      return 'I2C close'
    case 'set_pull':
      return `pull-ups ${a.enabled ? 'on' : 'off'} ${[a.las].flat().map((x) => (typeof x === 'number' ? `LA${x}` : String(x))).join(', ')}`
    case 'capture_la': {
      const send = a.send as { bus?: string } | undefined
      return send?.bus ? `capture with an ${send.bus.toUpperCase()} send` : 'capture'
    }
    case 'spi_transfer':
      return `SPI ${hex(a.tx_hex)}`
    case 'can_write':
      return `CAN ${addr(a.can_id)} ${Array.isArray(a.data) ? a.data.map((b) => Number(b).toString(16).padStart(2, '0')).join(' ') : ''}`.trim()
    case 'gpio_write':
      return `GPIO ${[a.la].flat().join(', ')} = ${a.level}`
    case 'uart_write':
      return `UART "${String(a.text ?? '')}"`
    default: {
      const short = Object.entries(a)
        .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
      return short ? `${s.tool} ${short}` : s.tool
    }
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/x-python' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type SequencesPanelProps = {
  store: SequenceStore
  /** The BenchCall the dashboard's tabs use (logged), so a run shows in the transaction log too. */
  call: BenchCall
  /** The steps made from the log rows the user selected, oldest first. */
  selected: SequenceStep[]
  onClearSelection?: () => void
  /** The wiring's names by LA channel (index 0 = LA1), for the export's comments. */
  names?: readonly string[]
}

export function SequencesPanel({ store, call, selected, onClearSelection, names }: SequencesPanelProps) {
  const [list, setList] = useState<BusSequence[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<{ name: string; shared: boolean; copyOf?: BusSequence } | null>(null)
  const [renaming, setRenaming] = useState<{ seq: BusSequence; name: string } | null>(null)
  const [exporting, setExporting] = useState<{ seq: BusSequence; code: string } | null>(null)
  const [running, setRunning] = useState<{ id: string; outcomes: (StepOutcome | null)[]; done: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const stop = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    try {
      setList(await store.list())
      setError(null)
    } catch (e) {
      setError(`Could not load the sequences: ${(e as Error).message}`)
      setList((l) => l ?? [])
    }
  }, [store])
  useEffect(() => {
    void reload()
  }, [reload])

  const act = async (what: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await what()
      await reload()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!saving) return
    const steps = saving.copyOf ? saving.copyOf.steps : selected
    const ok = await act(() => store.create({ name: saving.name.trim(), steps, version: SEQUENCE_VERSION, shared: store.canShare ? saving.shared : undefined }))
    if (ok) {
      setSaving(null)
      if (!saving.copyOf) onClearSelection?.()
    }
  }

  const run = async (seq: BusSequence) => {
    stop.current?.abort()
    const ctl = new AbortController()
    stop.current = ctl
    setRunning({ id: seq.id, outcomes: seq.steps.map(() => null), done: false })
    const outcomes = await runSequence(
      call,
      seq.steps,
      (i, o) => setRunning((r) => (r && r.id === seq.id ? { ...r, outcomes: r.outcomes.map((x, j) => (j === i ? o : x)) } : r)),
      ctl.signal,
    )
    setRunning((r) => (r && r.id === seq.id ? { ...r, outcomes, done: true } : r))
  }

  const n = selected.length
  return (
    <Stack gap={6} data-testid="bus-sequences">
      <Group justify="space-between" gap="xs">
        <Text size="xs" fw={600}>
          Sequences
        </Text>
        <Group gap={4}>
          {n ? (
            <Button size="compact-xs" variant="subtle" onClick={onClearSelection}>
              Clear selection
            </Button>
          ) : null}
          <Tooltip label="Select rows in the log first" disabled={n > 0}>
            <Button size="compact-xs" disabled={!n} onClick={() => setSaving({ name: '', shared: false })}>
              {n ? `Save ${n} ${n === 1 ? 'step' : 'steps'}` : 'Save steps'}
            </Button>
          </Tooltip>
        </Group>
      </Group>

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(null)}>
          <Text size="xs">{error}</Text>
        </Alert>
      ) : null}

      {list === null ? (
        <Text size="xs" c="dimmed">
          Loading...
        </Text>
      ) : list.length === 0 ? (
        <Text size="xs" c="dimmed">
          Select rows in the log and save them as a sequence: run it again later, or export it as a pytest test.
        </Text>
      ) : (
        <Stack gap={4}>
          {list.map((seq) => {
            const r = running?.id === seq.id ? running : null
            const mine = seq.mine !== false
            return (
              <Paper key={seq.id} withBorder radius="sm" p={6}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text size="xs" fw={500} truncate>
                      {seq.name}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                      {seq.steps.length} {seq.steps.length === 1 ? 'step' : 'steps'}
                    </Text>
                    {seq.shared && mine ? (
                      <Badge size="xs" variant="light">
                        shared
                      </Badge>
                    ) : null}
                    {!mine ? (
                      <Badge size="xs" variant="light" color="gray">
                        {seq.owner?.name ? `from ${seq.owner.name}` : 'shared'}
                      </Badge>
                    ) : null}
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    {r && !r.done ? (
                      <Button size="compact-xs" variant="light" color="red" onClick={() => stop.current?.abort()}>
                        Stop
                      </Button>
                    ) : (
                      <Button size="compact-xs" variant="light" onClick={() => void run(seq)} disabled={!!running && !running.done}>
                        Run
                      </Button>
                    )}
                    <Button size="compact-xs" variant="default" onClick={() => setExporting({ seq, code: sequenceToPytest(seq, { names }) })}>
                      pytest
                    </Button>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon size="sm" variant="subtle" aria-label={`More for ${seq.name}`}>
                          ...
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {mine ? (
                          <>
                            <Menu.Item onClick={() => setRenaming({ seq, name: seq.name })}>Rename</Menu.Item>
                            {store.canShare ? (
                              <Menu.Item onClick={() => void act(() => store.update(seq.id, { shared: !seq.shared }))}>
                                {seq.shared ? 'Stop sharing' : 'Share in my organization'}
                              </Menu.Item>
                            ) : null}
                            <Menu.Item color="red" onClick={() => void act(() => store.remove(seq.id))}>
                              Delete
                            </Menu.Item>
                          </>
                        ) : (
                          <Menu.Item onClick={() => setSaving({ name: `${seq.name} (copy)`, shared: false, copyOf: seq })}>Save a copy</Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Group>
                {r ? (
                  <Stack gap={2} mt={4} data-testid="sequence-run">
                    {seq.steps.map((s, i) => {
                      const o = r.outcomes[i]
                      const st = o ? OUTCOME[o.status] : null
                      return (
                        <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                          <Badge size="xs" variant="light" color={st?.color ?? 'blue'} w={60} style={{ flexShrink: 0 }}>
                            {st?.label ?? (r.done ? 'skipped' : '...')}
                          </Badge>
                          <Text size="xs" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                            {stepLabel(s)}
                          </Text>
                          {o?.note ? (
                            <Text size="xs" c={o.status === 'error' ? 'red' : 'dimmed'}>
                              {o.note}
                            </Text>
                          ) : null}
                        </Group>
                      )
                    })}
                  </Stack>
                ) : null}
              </Paper>
            )
          })}
        </Stack>
      )}
      {store.where ? (
        <Text size="xs" c="dimmed">
          {store.where}
        </Text>
      ) : null}

      <Modal opened={!!saving} onClose={() => setSaving(null)} title={saving?.copyOf ? 'Save a copy' : 'Save as a sequence'} centered size="md">
        {saving ? (
          <Stack gap="sm">
            <TextInput label="Name" value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.currentTarget.value })} maxLength={128} data-autofocus />
            {store.canShare ? (
              <Checkbox
                label="Share in my organization (the other members can run it and export it, not change it)"
                checked={saving.shared}
                onChange={(e) => setSaving({ ...saving, shared: e.currentTarget.checked })}
              />
            ) : null}
            <Stack gap={2}>
              {(saving.copyOf?.steps ?? selected).map((s, i) => (
                <Text key={i} size="xs" ff="monospace">
                  {i + 1}. {stepLabel(s)}
                </Text>
              ))}
            </Stack>
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setSaving(null)}>
                Cancel
              </Button>
              <Button onClick={() => void save()} loading={busy} disabled={!saving.name.trim()}>
                Save
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      <Modal opened={!!renaming} onClose={() => setRenaming(null)} title="Rename the sequence" centered size="sm">
        {renaming ? (
          <Stack gap="sm">
            <TextInput label="Name" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.currentTarget.value })} maxLength={128} data-autofocus />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={!renaming.name.trim()}
                onClick={async () => {
                  if (await act(() => store.update(renaming.seq.id, { name: renaming.name.trim() }))) setRenaming(null)
                }}
              >
                Rename
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      <Modal opened={!!exporting} onClose={() => setExporting(null)} title={exporting ? pytestFileName(exporting.seq.name) : ''} centered size="xl">
        {exporting ? (
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              Each read asserts what the pod saw when you recorded the sequence. Edit the expected values here or in the file.
            </Text>
            <Textarea
              value={exporting.code}
              onChange={(e) => setExporting({ ...exporting, code: e.currentTarget.value })}
              rows={22}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }}
              aria-label="pytest code"
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => void navigator.clipboard?.writeText(exporting.code)}>
                Copy
              </Button>
              <Button onClick={() => download(pytestFileName(exporting.seq.name), exporting.code)}>Download</Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </Stack>
  )
}
