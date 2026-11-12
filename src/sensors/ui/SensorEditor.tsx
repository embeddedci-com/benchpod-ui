import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Anchor, Badge, Button, Card, Grid, Group, Stack, Text, Title } from '@mantine/core'
import type { Engine, ValidateOk } from '../engine'
import { KIND_LABELS } from '../model'
import type { PodSensorStatus, SensorPod } from '../pod'
import { isNameTaken, type SensorStore, type StoredDefinition } from '../store'
import { copyName, renameSource } from '../templates'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import type { FileHost } from './files'
import { useAnalysis } from './hooks'
import { DefinitionPreview, ParamSliders, defaultValues } from './Preview'
import { RunPanel, type BenchHooks, type RunBlock } from './RunPanel'

/** What the editor opened: one of the user's definitions, a library entry (read-only), or a new one. */
export type EditorDoc =
  | { from: 'mine'; id: string; source: string; name: string }
  | { from: 'library'; name: string; version: string; source: string }
  | { from: 'new'; source: string }

/** The YAML editor with live validation, a preview of what the DUT sees and the run panel. */
export function SensorEditor({
  doc,
  store,
  engine,
  engineError,
  pod,
  block,
  bench,
  status,
  files,
  onBack,
  onSaved,
  onStatusChanged,
  onCopyFromLibrary,
}: {
  doc: EditorDoc
  store: SensorStore
  engine: Engine | null
  engineError: string | null
  pod: SensorPod | null
  block: RunBlock
  bench: BenchHooks
  status: PodSensorStatus | null
  files: FileHost
  onBack: () => void
  onSaved: (d: StoredDefinition) => void
  onStatusChanged: () => void
  onCopyFromLibrary?: (name: string) => void
}) {
  const readOnly = doc.from === 'library'
  const [source, setSource] = useState(doc.source)
  const [saved, setSaved] = useState(doc.from === 'mine' ? doc.source : null)
  const [id, setId] = useState(doc.from === 'mine' ? doc.id : null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const editor = useRef<CodeEditorHandle>(null)
  const a = useAnalysis(source, engine)
  const info = a.result && a.result.ok && a.result.kind !== 'stimulus' ? (a.result as ValidateOk) : null
  const [values, setValues] = useState<Record<string, number>>({})
  // Keep the preview's values when params stay; take the defaults for new ones.
  const paramsKey = info ? info.params.map((p) => `${p.key}:${p.min}:${p.max}:${p.default}`).join(',') : ''
  useEffect(() => {
    if (!info) return
    setValues((v) => {
      const next = defaultValues(info.params)
      for (const p of info.params) if (v[p.key] !== undefined && v[p.key] >= p.min && v[p.key] <= p.max) next[p.key] = v[p.key]
      return next
    })
  }, [paramsKey])

  const dirty = !readOnly && source !== saved
  const name = a.converted && typeof a.converted.doc.name === 'string' ? a.converted.doc.name : doc.from === 'mine' ? doc.name : ''
  const running = useMemo(() => status?.instances.find((i) => i.instance === name && i.running) ?? null, [status, name])

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    setSavedNote(null)
    try {
      const d = await store.save(source, id ?? undefined)
      setId(d.id)
      setSaved(source)
      setSavedNote('Saved.')
      onSaved(d)
    } catch (e) {
      setSaveError(isNameTaken(e) ? `${(e as Error).message}. Change name: and save again.` : (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const download = () => {
    const ext = a.converted?.format === 'json' ? 'json' : 'yaml'
    files.save({ blob: new Blob([source], { type: 'text/plain' }), filename: `${name || 'sensor'}.${ext}` })
  }

  const title = doc.from === 'library' ? `${name} (library ${doc.version})` : doc.from === 'new' && !id ? 'New sensor' : name
  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button variant="subtle" size="xs" onClick={onBack}>
            Back
          </Button>
          <Title order={4}>{title}</Title>
          {info && <Badge variant="light">{KIND_LABELS[info.kind]}</Badge>}
          {dirty && (
            <Badge color="yellow" variant="light">
              unsaved
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={download}>
            Download
          </Button>
          {readOnly ? (
            onCopyFromLibrary && (
              <Button size="xs" onClick={() => onCopyFromLibrary(doc.name)}>
                Duplicate to My sensors
              </Button>
            )
          ) : (
            <>
              {id && (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => {
                    setId(null)
                    setSaved(null)
                    setSource(renameSource(source, copyName(name || 'sensor')))
                  }}
                >
                  Save as copy
                </Button>
              )}
              <Button size="xs" onClick={save} loading={saving} disabled={!dirty && !!id}>
                Save
              </Button>
            </>
          )}
        </Group>
      </Group>
      {engineError && <Alert color="red">{engineError}</Alert>}
      {saveError && (
        <Alert color="red" variant="light" title="Not saved">
          {saveError}
        </Alert>
      )}
      {savedNote && !dirty && (
        <Text size="xs" c="green">
          {savedNote}
        </Text>
      )}
      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Stack gap="xs">
            <CodeEditor ref={editor} value={source} onChange={readOnly ? undefined : setSource} readOnly={readOnly} errorLine={a.errorLine} />
            <ValidationLine analysis={a} engineReady={!!engine} onGoTo={(l) => editor.current?.goToLine(l)} />
            <Text size="xs" c="dimmed">
              The format is described in the{' '}
              <Anchor href="https://github.com/embeddedci-com/benchpod-sensors/blob/main/docs/format.md" target="_blank" rel="noreferrer" size="xs">
                sensor library
              </Anchor>
              . JSON with the same structure works too.
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" padding="md">
            <Stack gap="md">
              <Text fw={600}>Preview</Text>
              {info && a.converted && engine ? (
                <>
                  <ParamSliders params={info.params} values={values} onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))} />
                  <DefinitionPreview engine={engine} json={a.converted.json} info={info} values={values} />
                </>
              ) : (
                <Text size="sm" c="dimmed">
                  {a.result && a.result.ok && a.result.kind === 'stimulus'
                    ? 'This is a stimulus: open it from Stimuli.'
                    : !engine
                      ? 'Loading the sensor engine...'
                      : 'Fix the error to see the preview.'}
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
      {info && a.converted && (
        <Card withBorder radius="md" padding="md" aria-label="Run on the pod">
          <Stack gap="sm">
            <Text fw={600}>Run on the pod</Text>
            <RunPanel
              pod={pod}
              block={block}
              info={info}
              json={a.converted.json}
              defaultInstance={info.name}
              running={running}
              bench={bench}
              onChanged={onStatusChanged}
            />
          </Stack>
        </Card>
      )}
    </Stack>
  )
}

/** "Valid", or the error with a link to its line. */
export function ValidationLine({
  analysis,
  engineReady,
  onGoTo,
}: {
  analysis: ReturnType<typeof useAnalysis>
  engineReady: boolean
  onGoTo: (line: number) => void
}) {
  if (analysis.error) {
    return (
      <Alert color="red" variant="light" p="xs" aria-label="Validation error">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          {analysis.errorLine !== null && (
            <Anchor component="button" type="button" size="sm" onClick={() => onGoTo(analysis.errorLine!)} style={{ whiteSpace: 'nowrap' }}>
              Line {analysis.errorLine}
            </Anchor>
          )}
          <Text size="sm" style={{ wordBreak: 'break-word' }}>
            {analysis.error}
          </Text>
        </Group>
      </Alert>
    )
  }
  if (!engineReady) {
    return (
      <Text size="xs" c="dimmed">
        Checking...
      </Text>
    )
  }
  const r = analysis.result
  return (
    <Text size="xs" c="green" aria-label="Validation result">
      Valid{r && r.ok ? `: ${r.program_bytes} bytes compiled` : ''}.
    </Text>
  )
}
