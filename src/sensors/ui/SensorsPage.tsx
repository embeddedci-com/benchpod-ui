import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Group, Menu, Select, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core'
import type { DefinitionKind, SensorKind } from '../engine'
import { KIND_LABELS, SENSOR_KINDS } from '../model'
import type { SensorPod } from '../pod'
import { copyLibraryEntry, isNameTaken, type DefinitionSummary, type LibraryListing, type LibrarySettings, type SensorStore } from '../store'
import { templateFor } from '../templates'
import { browserFiles, DEFINITION_ACCEPT, type FileHost } from './files'
import { useEngine, usePodStatus } from './hooks'
import { InstanceCard, type BenchHooks } from './RunPanel'
import { SensorEditor, type EditorDoc } from './SensorEditor'
import { StimulusEditor } from './StimulusEditor'

export type SensorsPageProps = {
  store: SensorStore
  /** The pod to run on; null when there is none (library and editor still work). */
  pod: SensorPod | null
  podOnline: boolean
  /** The pod plays user-defined sensors (capability `sensors`); null while unknown. */
  capable: boolean | null
  /** Opens the host's firmware update flow (the notice's button). */
  onUpdateFirmware?: () => void
  bench?: BenchHooks
  files?: FileHost
  /** Shown above the tabs (the host's own cards, e.g. pull resistors, go below). */
  children?: React.ReactNode
}

type View = { tab: 'sensors' | 'stimuli' | 'pod' } & (
  | { open: null }
  | { open: 'editor'; doc: EditorDoc }
  | { open: 'stimulus'; id?: string; source: string }
)

/** The Sensors page: the library, the user's sensors and stimuli, the editor, what runs on the pod. */
export function SensorsPage({ store, pod, podOnline, capable, onUpdateFirmware, bench = {}, files = browserFiles, children }: SensorsPageProps) {
  const { engine, error: engineError } = useEngine()
  const [view, setView] = useState<View>({ tab: 'sensors', open: null })
  const [mine, setMine] = useState<DefinitionSummary[] | null>(null)
  const [mineError, setMineError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ color: string; text: string } | null>(null)
  const runnable = !!pod && podOnline && capable === true
  const block = !pod ? 'No pod' : !podOnline ? 'The pod is offline' : capable === false ? 'Needs newer pod firmware' : capable === null ? 'Checking the pod' : null
  const { status, refresh } = usePodStatus(pod, runnable)

  const reload = useCallback(async () => {
    try {
      setMine((await store.list()).definitions)
      setMineError(null)
    } catch (e) {
      setMineError((e as Error).message)
    }
  }, [store])
  useEffect(() => void reload(), [reload])

  const fail = (e: unknown) => setMessage({ color: 'red', text: (e as Error).message })
  const ok = (text: string) => setMessage({ color: 'green', text })

  const openMine = async (id: string) => {
    try {
      const d = await store.get(id)
      if (d.kind === 'stimulus') setView({ tab: 'stimuli', open: 'stimulus', id: d.id, source: d.source })
      else setView({ tab: 'sensors', open: 'editor', doc: { from: 'mine', id: d.id, source: d.source, name: d.name } })
    } catch (e) {
      fail(e)
    }
  }
  const copyFromLibrary = async (name: string, version?: string) => {
    try {
      const d = await copyLibraryEntry(store, name, version)
      await reload()
      ok(`Copied ${name} to My sensors as ${d.name}.`)
      setView({ tab: 'sensors', open: 'editor', doc: { from: 'mine', id: d.id, source: d.source, name: d.name } })
    } catch (e) {
      fail(e)
    }
  }
  const upload = async () => {
    const picked = await files.open({ accept: DEFINITION_ACCEPT, multiple: true })
    for (const f of picked) {
      try {
        const r = await store.upload(f, f.name)
        ok(`Uploaded ${r.definition.name}.`)
      } catch (e) {
        if (isNameTaken(e) && window.confirm(`${(e as Error).message}\n\nReplace it?`)) {
          try {
            const r = await store.upload(f, f.name, { replace: true })
            ok(`Replaced ${r.definition.name}.`)
          } catch (e2) {
            fail(e2)
          }
        } else fail(e)
      }
    }
    await reload()
  }

  const params = useMemo(() => {
    const out = new Set<string>()
    const inst = status?.instances ?? []
    for (const i of inst) for (const k of Object.keys(i.values ?? {})) out.add(inst.length > 1 ? `${i.instance}.${k}` : k)
    return [...out]
  }, [status])

  const notice = capable === false && (
    <Alert color="blue" variant="light" title="Update your firmware to run sensors">
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Text size="sm">This pod's firmware plays only its built-in sensors. Newer firmware plays any sensor you define here. You can still browse, edit and preview.</Text>
        {onUpdateFirmware && (
          <Button size="xs" onClick={onUpdateFirmware} disabled={!podOnline}>
            Update firmware
          </Button>
        )}
      </Group>
    </Alert>
  )

  if (view.open === 'editor') {
    return (
      <Stack gap="md">
        {notice}
        <SensorEditor
          key={view.doc.from === 'mine' ? view.doc.id : view.doc.from === 'library' ? `lib-${view.doc.name}` : 'new'}
          doc={view.doc}
          store={store}
          engine={engine}
          engineError={engineError}
          pod={pod}
          block={block}
          bench={bench}
          status={status}
          files={files}
          onBack={() => setView({ tab: 'sensors', open: null })}
          onSaved={() => void reload()}
          onStatusChanged={refresh}
          onCopyFromLibrary={(name) => void copyFromLibrary(name, view.doc.from === 'library' ? view.doc.version : undefined)}
        />
      </Stack>
    )
  }
  if (view.open === 'stimulus') {
    return (
      <Stack gap="md">
        {notice}
        <StimulusEditor
          key={view.id ?? 'new'}
          initial={{ id: view.id, source: view.source }}
          store={store}
          engine={engine}
          pod={pod}
          block={block}
          status={status}
          files={files}
          paramSuggestions={params}
          onBack={() => setView({ tab: 'stimuli', open: null })}
          onSaved={() => void reload()}
          onStatusChanged={refresh}
        />
      </Stack>
    )
  }

  const sensors = (mine ?? []).filter((d) => d.kind !== 'stimulus')
  const stimuli = (mine ?? []).filter((d) => d.kind === 'stimulus')
  const running = (status?.instances ?? []).filter((i) => i.running)
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Sensors</Title>
        {running.length > 0 && (
          <Badge color="green" variant="light">
            {running.length} running on the pod
          </Badge>
        )}
      </Group>
      {notice}
      {message && (
        <Alert color={message.color} variant="light" withCloseButton onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {mineError && <Alert color="red">{mineError}</Alert>}
      <Tabs
        value={view.tab}
        onChange={(t) => {
          if (!t) return
          setView({ tab: t as View['tab'], open: null })
          void reload()
          if (t === 'pod') refresh()
        }}
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab value="sensors">Sensors</Tabs.Tab>
          <Tabs.Tab value="stimuli">Stimuli</Tabs.Tab>
          <Tabs.Tab value="pod">On the pod{running.length ? ` (${running.length})` : ''}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="sensors" pt="md">
          <Stack gap="lg">
            <MyDefinitions
              title="My sensors"
              kinds={SENSOR_KINDS}
              defs={sensors}
              loading={mine === null}
              store={store}
              files={files}
              onOpen={openMine}
              onNew={(kind) => setView({ tab: 'sensors', open: 'editor', doc: { from: 'new', source: templateFor(kind) } })}
              onUpload={upload}
              onChanged={reload}
              onError={fail}
              empty="No sensors yet. Duplicate one from the library, start from a template, or upload a file."
            />
            <LibraryCard store={store} files={files} onOpen={(doc) => setView({ tab: 'sensors', open: 'editor', doc })} onCopy={copyFromLibrary} onError={fail} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="stimuli" pt="md">
          <MyDefinitions
            title="Stimuli"
            kinds={['stimulus']}
            defs={stimuli}
            loading={mine === null}
            store={store}
            files={files}
            onOpen={openMine}
            onNew={() => setView({ tab: 'stimuli', open: 'stimulus', source: templateFor('stimulus') })}
            onUpload={upload}
            onChanged={reload}
            onError={fail}
            empty="No stimuli yet. A stimulus changes a running sensor's values over time and injects faults."
          />
        </Tabs.Panel>
        <Tabs.Panel value="pod" pt="md">
          <Stack gap="md">
            {block && (
              <Text size="sm" c="dimmed">
                {block}.
              </Text>
            )}
            {!block && running.length === 0 && (
              <Text size="sm" c="dimmed">
                Nothing runs on the pod. Open a sensor and start it from its Run on the pod panel.
              </Text>
            )}
            {status?.stimulus?.loaded && (
              <Text size="sm">
                Stimulus {status.stimulus.running ? `running, t = ${(status.stimulus.t_s ?? 0).toFixed(1)} s` : 'loaded, stopped'}
              </Text>
            )}
            {running.map((i) => (
              <InstanceCard key={i.instance} pod={pod} inst={i} block={block} onChanged={refresh} />
            ))}
            {running.length > 1 && (
              <Group>
                <Button color="red" variant="light" size="xs" onClick={() => pod?.stop().then(refresh, fail)}>
                  Stop all
                </Button>
              </Group>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      {children}
    </Stack>
  )
}

const fmtDate = (s: string) => {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

function MyDefinitions({
  title,
  kinds,
  defs,
  loading,
  store,
  files,
  onOpen,
  onNew,
  onUpload,
  onChanged,
  onError,
  empty,
}: {
  title: string
  kinds: DefinitionKind[]
  defs: DefinitionSummary[]
  loading: boolean
  store: SensorStore
  files: FileHost
  onOpen: (id: string) => void
  onNew: (kind: SensorKind) => void
  onUpload: () => void
  onChanged: () => Promise<void>
  onError: (e: unknown) => void
  empty: string
}) {
  const stimulus = kinds.includes('stimulus')
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      onError(e)
    }
  }
  return (
    <Card withBorder radius="md" padding="md" aria-label={title}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Text fw={600}>{title}</Text>
          <Group gap="xs">
            {stimulus ? (
              <Button size="xs" onClick={() => onNew('i2c')}>
                New stimulus
              </Button>
            ) : (
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button size="xs">New sensor</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Start from a template</Menu.Label>
                  {SENSOR_KINDS.map((k) => (
                    <Menu.Item key={k} onClick={() => onNew(k)}>
                      {KIND_LABELS[k]} sensor
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
            <Button size="xs" variant="default" onClick={onUpload}>
              Upload
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={defs.length === 0}
              onClick={() => run(async () => files.save(await store.zip(stimulus ? { kind: 'stimulus' } : {})))}
            >
              Download all
            </Button>
          </Group>
        </Group>
        {loading ? (
          <Text size="sm" c="dimmed">
            Loading...
          </Text>
        ) : defs.length === 0 ? (
          <Text size="sm" c="dimmed">
            {empty}
          </Text>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table highlightOnHover verticalSpacing={6} miw={560}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  {!stimulus && <Table.Th>Kind</Table.Th>}
                  <Table.Th>Label</Table.Th>
                  <Table.Th>Changed</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {defs.map((d) => (
                  <Table.Tr key={d.id}>
                    <Table.Td>
                      <Button variant="subtle" size="compact-sm" onClick={() => onOpen(d.id)}>
                        {d.name}
                      </Button>
                    </Table.Td>
                    {!stimulus && (
                      <Table.Td>
                        <Badge variant="light" size="sm">
                          {KIND_LABELS[d.kind]}
                        </Badge>
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>
                        {d.label}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {fmtDate(d.updated_at)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Button size="compact-xs" variant="subtle" onClick={() => run(async () => (await store.duplicate(d.id), await onChanged()))}>
                          Duplicate
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => run(async () => files.save(await store.download(d.id)))}>
                          Download
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          onClick={() => window.confirm(`Delete ${d.name}? This cannot be undone.`) && run(async () => (await store.delete(d.id), await onChanged()))}
                        >
                          Delete
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </Card>
  )
}

const VERSION_RE = /^\d+\.\d+\.\d+$/

function LibraryCard({
  store,
  files,
  onOpen,
  onCopy,
  onError,
}: {
  store: SensorStore
  files: FileHost
  onOpen: (doc: EditorDoc) => void
  onCopy: (name: string, version?: string) => void
  onError: (e: unknown) => void
}) {
  const [lib, setLib] = useState<LibraryListing | null>(null)
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [libError, setLibError] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([store.library(), store.librarySettings().catch(() => null)])
      setLib(l)
      setSettings(s)
      setLibError(null)
    } catch (e) {
      setLibError((e as Error).message)
    }
  }, [store])
  useEffect(() => void load(), [load])

  const choice = settings ? (settings.override === '' ? 'pinned' : settings.override === 'latest' ? 'latest' : 'version') : 'pinned'
  const setVersion = async (v: string) => {
    setSaving(true)
    try {
      setSettings(await store.setLibraryVersion(v))
      await load()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }
  const open = async (name: string) => {
    try {
      const e = await store.libraryEntry(name)
      onOpen({ from: 'library', name: e.name, version: e.version, source: e.source })
    } catch (e) {
      onError(e)
    }
  }

  return (
    <Card withBorder radius="md" padding="md" aria-label="Library">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Text fw={600}>Library</Text>
            {lib && (
              <Badge variant="outline" size="sm">
                version {lib.version}
              </Badge>
            )}
          </Group>
          {settings?.can_change && (
            <Group gap="xs" align="flex-end">
              <Select
                size="xs"
                w={200}
                aria-label="Library version"
                data={[
                  { value: 'pinned', label: `Default (${settings.pinned_version})` },
                  { value: 'latest', label: 'Latest release' },
                  { value: 'version', label: 'A specific version' },
                ]}
                value={choice}
                disabled={saving}
                onChange={(v) => {
                  if (v === 'pinned') void setVersion('')
                  else if (v === 'latest') void setVersion('latest')
                  else setCustom(VERSION_RE.test(settings.override) ? settings.override : '')
                }}
              />
              {(choice === 'version' || custom !== '') && (
                <>
                  <TextInput
                    size="xs"
                    w={90}
                    aria-label="Library version number"
                    placeholder="0.1.0"
                    value={custom || (choice === 'version' ? settings.override : '')}
                    onChange={(e) => setCustom(e.currentTarget.value)}
                  />
                  <Button size="xs" variant="light" loading={saving} disabled={!VERSION_RE.test(custom)} onClick={() => setVersion(custom).then(() => setCustom(''))}>
                    Use
                  </Button>
                </>
              )}
            </Group>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          Ready-made sensors from the public sensor library. Open one to preview it or run it as is; duplicate it to change it.
          {settings?.can_change ? ' The version applies to your whole organization.' : ''}
        </Text>
        {libError && <Alert color="red">{libError}</Alert>}
        {lib?.warnings?.map((w) => (
          <Text key={w} size="xs" c="orange">
            {w}
          </Text>
        ))}
        {lib && (
          <div style={{ overflowX: 'auto' }}>
            <Table highlightOnHover verticalSpacing={6} miw={560}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Label</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lib.entries.map((e) => (
                  <Table.Tr key={e.name}>
                    <Table.Td>
                      <Button variant="subtle" size="compact-sm" onClick={() => open(e.name)}>
                        {e.name}
                      </Button>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" size="sm">
                        {KIND_LABELS[e.kind] ?? e.kind}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>
                        {e.label}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Copy it to My sensors to change it">
                          <Button size="compact-xs" variant="subtle" onClick={() => onCopy(e.name)}>
                            Duplicate
                          </Button>
                        </Tooltip>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={async () => {
                            try {
                              files.save(await store.libraryDownload(e.name))
                            } catch (err) {
                              onError(err)
                            }
                          }}
                        >
                          Download
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </Card>
  )
}
