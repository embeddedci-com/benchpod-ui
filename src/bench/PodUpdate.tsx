import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, FileButton, Group, Stack, Text } from '@mantine/core'
import { TerminalText } from '../results/ResultView'

// Update the pod's own firmware: the latest release, a chosen one, or release files picked from
// this computer (no internet). The host runs the update (the desktop app: the benchpod CLI's
// flash-self --network) and streams its lines.

export type PodFirmwareInfo = {
  running?: string
  gateware?: number
  latest?: string
  latest_error?: string
  cli?: string
  cli_error?: string
  files?: string[]
  offline?: boolean
}

export type PodUpdater = {
  info(): Promise<PodFirmwareInfo>
  addFile(file: File): Promise<string[]>
  clearFiles(): Promise<void>
  /** Run the update; onLine gets each line. Resolves when the host is done. */
  update(opts: { version?: string; files?: boolean }, onLine: (line: string) => void): Promise<{ ok: boolean; error?: string }>
}

/** "3.10.1" < "3.10.2": compare dotted versions numerically. */
export function newerVersion(latest?: string, running?: string): boolean {
  if (!latest || !running) return false
  const a = latest.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const b = running.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

const IMAGE = 'bench_pod_stm32.bin'

export function PodUpdate({ updater, connected }: { updater: PodUpdater; connected: boolean }) {
  const [info, setInfo] = useState<PodFirmwareInfo | null>(null)
  const [ask, setAsk] = useState<{ version?: string; files?: boolean; label: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [error, setError] = useState<string | undefined>()
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setInfo(await updater.info())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [updater])
  useEffect(() => {
    void load()
  }, [load, connected])
  // A block body: scrollIntoView returns a promise in newer browsers, never a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  const run = async () => {
    if (!ask) return
    const opts = { version: ask.version, files: ask.files }
    setAsk(null)
    setRunning(true)
    setLines([])
    setResult(null)
    setError(undefined)
    try {
      setResult(await updater.update(opts, (l) => setLines((old) => [...old.slice(-400), l])))
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message })
    } finally {
      setRunning(false)
      void load()
    }
  }

  const addFiles = async (files: File[]) => {
    setError(undefined)
    try {
      let names: string[] = []
      for (const f of files) names = await updater.addFile(f)
      setInfo((i) => ({ ...(i ?? {}), files: names }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const files = info?.files ?? []
  const hasImage = files.includes(IMAGE)
  const update = newerVersion(info?.latest, info?.running)

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm">
          Firmware {info?.running ? <b>{info.running}</b> : <Text span c="dimmed">unknown (connect the pod)</Text>}
          {info?.gateware ? <Text span size="xs" c="dimmed">{` · gateware ${info.gateware}`}</Text> : null}
        </Text>
        {update ? (
          <Badge color="blue" variant="light">
            {info?.latest} available
          </Badge>
        ) : info?.latest && info.running ? (
          <Badge color="green" variant="light">
            up to date
          </Badge>
        ) : null}
      </Group>
      {info?.cli_error ? (
        <Text size="xs" c="red">
          {info.cli_error}
        </Text>
      ) : null}

      {!info?.offline ? (
        <Group gap="xs">
          <Button
            size="xs"
            variant={update ? 'filled' : 'light'}
            disabled={running || !info?.cli || !connected}
            onClick={() => setAsk({ version: 'latest', label: `Install the latest release${info?.latest ? ` (${info.latest})` : ''}` })}
          >
            {update ? `Update to ${info?.latest}` : 'Install the latest release'}
          </Button>
          {info?.latest_error ? (
            <Text size="xs" c="dimmed">
              Could not check for a new release: {info.latest_error}
            </Text>
          ) : null}
        </Group>
      ) : null}

      <Text size="xs" c="dimmed">
        {info?.offline ? 'Offline: ' : 'Without internet: '}download the release files from github.com/embeddedci-com/benchpod-firmware on another computer ({IMAGE},
        its .sig, blobs-manifest.json and the blob-*.bin files with their .sig), then add them here.
      </Text>
      <Group gap="xs">
        <FileButton multiple onChange={(f) => void addFiles(f)} accept=".bin,.sig,.json">
          {(props) => (
            <Button size="xs" variant="default" disabled={running} {...props}>
              Add release files…
            </Button>
          )}
        </FileButton>
        {files.length ? (
          <>
            <Button size="xs" variant="light" disabled={running || !hasImage || !info?.cli || !connected} onClick={() => setAsk({ files: true, label: `Install ${IMAGE} from the added files` })}>
              Install these
            </Button>
            <Button size="xs" variant="subtle" color="gray" disabled={running} onClick={() => void updater.clearFiles().then(load)}>
              Clear
            </Button>
          </>
        ) : null}
      </Group>
      {files.length ? (
        <Text size="xs" c="dimmed" ff="monospace">
          {files.join(' · ')}
          {!files.includes('blobs-manifest.json') ? ' (no blobs-manifest.json: the gateware and Wi-Fi bridge images stay as they are)' : ''}
        </Text>
      ) : null}

      {ask ? (
        // Asked in place: a modal opened from inside a drawer breaks Mantine's cleanup.
        <Alert color="blue" variant="light" p="sm" title="Update the pod's firmware?">
          <Stack gap="xs">
            <Text size="sm">{ask.label}.</Text>
            <Text size="xs" c="dimmed">
              The pod restarts into it, then gets its gateware and Wi-Fi bridge images. It takes a minute or two. Keep it plugged in until it says done.
            </Text>
            <Group gap="xs">
              <Button size="xs" onClick={() => void run()}>
                Update
              </Button>
              <Button size="xs" variant="default" onClick={() => setAsk(null)}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : null}
      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs">{error}</Text>
        </Alert>
      ) : null}
      {lines.length || running ? (
        <Stack gap={4}>
          <TerminalText text={lines.join('\n') || 'starting…'} maxHeight={260} />
          <div ref={end} />
        </Stack>
      ) : null}
      {result ? (
        <Text size="sm" c={result.ok ? 'teal' : 'red'}>
          {result.ok ? 'The pod runs the new firmware.' : result.error || 'The update did not finish.'}
        </Text>
      ) : null}

    </Stack>
  )
}
