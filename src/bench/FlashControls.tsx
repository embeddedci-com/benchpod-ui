import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Checkbox, Divider, FileButton, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { TerminalText } from '../results/ResultView'
import { benchData, benchError, type BenchCall } from './benchCall'

// Flash the board's firmware from a file, by hand: the web app's Flash tab for a host's bench
// panel. The host stores the file where its flash tool can read it (upload) and lists the recent
// ones; the SWD pins, the reset line and the OpenOCD target come from the wiring.

export type FirmwareFile = { name: string; path: string; size: number; modified: string }

export type FirmwareStore = {
  upload(file: File): Promise<FirmwareFile>
  recent(): Promise<FirmwareFile[]>
}

type FlashResult = { ok: boolean; returncode: number; target_unreachable: boolean; stalled: boolean; stdout_tail: string; stderr_tail: string }
type Wiring = { efuse?: number; swd_target?: string; swd_nreset?: boolean; profile?: Record<string, unknown> }

/**
 * The last flash and boot log, kept while the page lives: a host that unmounts the Flash tab when
 * another tab opens shows them again on return.
 */
const kept: { result: FlashResult | null; ms?: number; boot: string | null } = { result: null, boot: null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fmtSize(n: number): string {
  return n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`
}

export function FlashControls({ call, firmware }: { call: BenchCall; firmware: FirmwareStore }) {
  const [files, setFiles] = useState<FirmwareFile[]>([])
  const [path, setPath] = useState<string | null>(null)
  const [wiring, setWiring] = useState<Wiring | null>(null)
  const [target, setTarget] = useState('')
  const [nreset, setNreset] = useState(false)
  const [address, setAddress] = useState('0x08000000')
  const [powerFirst, setPowerFirst] = useState(true)
  const [verify, setVerify] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [result, setResultState] = useState<FlashResult | null>(kept.result)
  const [ms, setMsState] = useState<number | undefined>(kept.ms)
  const [showLog, setShowLog] = useState(false)
  const [boot, setBootState] = useState<string | null>(kept.boot)
  const [bootNote, setBootNote] = useState<string | null>(null)
  const setResult = (r: FlashResult | null) => setResultState((kept.result = r))
  const setMs = (v: number | undefined) => setMsState((kept.ms = v))
  const setBoot = (v: string | null) => setBootState((kept.boot = v))

  const loadFiles = useCallback(async () => {
    try {
      const f = await firmware.recent()
      setFiles(f)
      setPath((p) => p ?? f[0]?.path ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [firmware])

  useEffect(() => {
    void loadFiles()
    void call('wiring', {}, { poll: true }).then((r) => {
      const w = benchData<Wiring>(r)
      if (!w) return
      setWiring(w)
      setTarget(w.swd_target ?? '')
      setNreset(!!w.swd_nreset)
    })
  }, [call, loadFiles])

  const pick = async (f: File | null) => {
    if (!f) return
    setBusy('upload')
    setError(undefined)
    try {
      const up = await firmware.upload(f)
      await loadFiles()
      setPath(up.path)
      setResult(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const current = files.find((f) => f.path === path)
  const isBin = !!current && /\.bin$/i.test(current.name)

  const flash = async () => {
    if (!path) return
    setBusy('flash')
    setError(undefined)
    setResult(null)
    setBoot(null)
    try {
      const args: Record<string, unknown> = { file: path, nreset, verify }
      if (target.trim()) args.target = target.trim()
      if (isBin) args.load_address = address
      if (powerFirst) args.target_power = wiring?.efuse === 2 ? 2 : 1
      const r = await call('flash', args)
      const e = benchError(r)
      if (e) setError(e)
      const d = benchData<FlashResult>(r)
      if (d) {
        setResult(d)
        setMs(r.ms)
        setShowLog(!d.ok)
      }
    } finally {
      setBusy(null)
    }
  }

  const bootLog = async () => {
    setBusy('boot')
    setError(undefined)
    try {
      const r = await call('power_cycle_and_capture', { duration: 4 })
      const e = benchError(r)
      // The console has the UART open: power-cycle, and the boot log shows in the console.
      if (e && /in use by uart/i.test(e)) {
        const efuse = wiring?.efuse === 2 ? 2 : 1
        const off = await call('power_off', { efuse })
        if (off.declined) return
        const offErr = benchError(off)
        if (offErr) return setError(offErr)
        await sleep(500)
        const on = await call('power_on', { efuse }, { approved: true })
        const onErr = benchError(on)
        if (onErr) return setError(onErr)
        setBoot(null)
        setBootNote('The console has the UART open, so the boot log is in the Console.')
        return
      }
      if (e) setError(e)
      const d = benchData<{ text: string }>(r)
      if (d) {
        setBootNote(null)
        setBoot(d.text || '(nothing on the console)')
      }
    } finally {
      setBusy(null)
    }
  }

  // The target worked: keep it in the wiring so the next flash (and the agent) use it.
  const keepTarget = async () => {
    if (!wiring?.profile) return
    const r = await call('set_wiring', { profile: { ...wiring.profile, swd_target: target.trim(), swd_nreset: nreset } })
    const e = benchError(r)
    if (e) setError(e)
    else if (!r.declined) setWiring({ ...wiring, swd_target: target.trim(), swd_nreset: nreset, profile: { ...wiring.profile, swd_target: target.trim(), swd_nreset: nreset } })
  }
  const targetChanged = !!wiring && (target.trim() !== (wiring.swd_target ?? '') || nreset !== !!wiring.swd_nreset)

  return (
    <Stack gap="sm" p="sm">
      <Group gap="xs" align="flex-end">
        <Select
          size="xs"
          style={{ flex: 1, minWidth: 200 }}
          label="Firmware file"
          placeholder="choose a file"
          data={files.map((f) => ({ value: f.path, label: `${f.name} · ${fmtSize(f.size)}` }))}
          value={path}
          onChange={setPath}
          allowDeselect={false}
          nothingFoundMessage="none yet"
        />
        <FileButton onChange={(f) => void pick(f)} accept=".elf,.hex,.bin,.axf,.out,.srec,.s19">
          {(props) => (
            <Button size="xs" variant="default" loading={busy === 'upload'} {...props}>
              Choose…
            </Button>
          )}
        </FileButton>
      </Group>
      <Group gap="xs" align="flex-end">
        <TextInput
          size="xs"
          style={{ flex: 1, minWidth: 180 }}
          label="OpenOCD target (your board's chip)"
          placeholder="target/stm32f4x.cfg"
          value={target}
          onChange={(e) => setTarget(e.currentTarget.value)}
        />
        {isBin ? <TextInput size="xs" w={120} label="Load address" value={address} onChange={(e) => setAddress(e.currentTarget.value)} /> : null}
      </Group>
      <Group gap="md">
        <Checkbox size="xs" label="Reset line wired (connect under reset)" checked={nreset} onChange={(e) => setNreset(e.currentTarget.checked)} />
        <Checkbox size="xs" label="Power the board first" checked={powerFirst} onChange={(e) => setPowerFirst(e.currentTarget.checked)} />
        <Checkbox size="xs" label="Verify" checked={verify} onChange={(e) => setVerify(e.currentTarget.checked)} />
      </Group>
      <Text size="xs" c="dimmed">
        SWD on {wiring?.profile?.swd_swclk ? `LA${wiring.profile.swd_swclk}` : 'SWCLK'} / {wiring?.profile?.swd_swdio ? `LA${wiring.profile.swd_swdio}` : 'SWDIO'} (from the wiring). OpenOCD runs on this
        computer.
      </Text>
      <Group gap="xs">
        <Button size="xs" onClick={() => void flash()} loading={busy === 'flash'} disabled={!path || !!busy || (!target.trim() && !wiring?.swd_target)}>
          Flash
        </Button>
        {targetChanged && result?.ok ? (
          <Button size="xs" variant="light" onClick={() => void keepTarget()} disabled={!!busy}>
            Keep this target in the wiring
          </Button>
        ) : null}
      </Group>

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}

      {result ? (
        <Stack gap={6}>
          <Group gap="xs">
            <Badge color={result.ok ? 'green' : 'red'} variant="light">
              {result.ok ? 'flashed' : 'flash failed'}
            </Badge>
            {ms ? (
              <Text size="xs" c="dimmed">
                {(ms / 1000).toFixed(1)} s
              </Text>
            ) : null}
            {result.target_unreachable ? (
              <Text size="xs" c="red">
                The board did not answer on SWD: is it powered, wired as the wiring says, and not held in reset?
              </Text>
            ) : null}
            {result.stalled ? (
              <Text size="xs" c="red">
                OpenOCD stalled.
              </Text>
            ) : null}
            <Button size="compact-xs" variant="subtle" onClick={() => setShowLog(!showLog)}>
              {showLog ? 'Hide the log' : 'Show the log'}
            </Button>
          </Group>
          {showLog ? <TerminalText text={[result.stdout_tail, result.stderr_tail].filter(Boolean).join('\n') || '(no output)'} maxHeight={260} /> : null}
          {result.ok ? (
            <>
              <Divider />
              <Group gap="xs">
                <Button size="xs" variant="light" onClick={() => void bootLog()} loading={busy === 'boot'} disabled={!!busy}>
                  Power-cycle and show the boot log
                </Button>
              </Group>
              {bootNote ? (
                <Text size="xs" c="dimmed" data-testid="boot-note">
                  {bootNote}
                </Text>
              ) : null}
              {boot != null ? <TerminalText text={boot} maxHeight={260} /> : null}
            </>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  )
}
