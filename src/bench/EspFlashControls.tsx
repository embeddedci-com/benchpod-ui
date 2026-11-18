import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, FileButton, Group, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core'
import { TerminalText } from '../results/ResultView'
import { HelpTip } from '../help/HelpTip'
import { benchData, benchError, type BenchCall } from './benchCall'
import type { FirmwareFile, FirmwareStore } from './FlashControls'

// Flash an ESP32-family chip over its UART ROM bootloader, by hand. The pins come from the pins
// profile: uart_rx (the chip's TXD0), uart_tx (its RXD0) and a signal on its boot pin (IO0, IO9 on
// the C3/C6). EN goes on the pod's reset pin. The flash tool does the rest (the SDK's esp module).

/** The ESP32 chips the flash tool knows, as its `target`. */
export const ESP_CHIPS = ['esp32', 'esp32s2', 'esp32s3', 'esp32c3', 'esp32c6', 'esp32h2'] as const

/** Profile signal names the flash tool takes as the boot pin (embeddedci.benchpod.esp BOOT_SIGNALS). */
const BOOT_NAMES = ['BOOT', 'IO0', 'GPIO0', 'IO9', 'GPIO9', 'ESP_BOOT']

type Signal = { la: number; name: string }
type Profile = { uart_rx?: number | null; uart_tx?: number | null; signals?: Signal[] }
type FlashResult = { ok: boolean; stdout_tail?: string; stderr_tail?: string }

/** The profile's boot pin for an ESP32, or null. */
export function espBootPin(profile: Profile | undefined): number | null {
  const s = (profile?.signals ?? []).find((x) => BOOT_NAMES.includes(String(x.name).toUpperCase()))
  return s ? s.la : null
}

export function EspFlashControls({ call, firmware }: { call: BenchCall; firmware: FirmwareStore }) {
  const [files, setFiles] = useState<FirmwareFile[]>([])
  const [path, setPath] = useState<string | null>(null)
  const [chip, setChip] = useState<string>('esp32')
  const [address, setAddress] = useState('0x10000')
  const [profile, setProfile] = useState<Profile | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<FlashResult | null>(null)

  useEffect(() => {
    void (async () => {
      const w = benchData<{ profile?: Profile }>(await call('wiring', {}))
      setProfile(w?.profile ?? {})
      setFiles((await firmware.recent()).filter((f) => /\.bin$/i.test(f.name)))
    })()
  }, [call, firmware])

  const pick = async (f: File | null) => {
    if (!f) return
    setBusy('upload')
    try {
      const up = await firmware.upload(f)
      setFiles((await firmware.recent()).filter((x) => /\.bin$/i.test(x.name)))
      setPath(up.path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const rx = profile?.uart_rx ?? null
  const tx = profile?.uart_tx ?? null
  const boot = espBootPin(profile)
  const pinsSet = !!(rx && tx && boot)

  const flash = async () => {
    if (!path || !pinsSet) return
    setBusy('flash')
    setError(undefined)
    setResult(null)
    try {
      const r = await call('flash', { target: chip, file: path, load_address: address, nreset: true, rx, tx, boot })
      const e = benchError(r)
      if (e) setError(e)
      const d = benchData<FlashResult>(r)
      if (d) setResult(d)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Stack gap="sm" p="sm">
      <Group gap="xs" align="flex-end">
        <Select
          size="xs"
          w={120}
          label="Chip"
          data={ESP_CHIPS.map((c) => ({ value: c, label: c.toUpperCase().replace('ESP32', 'ESP32-').replace(/-$/, '') }))}
          value={chip}
          onChange={(v) => v && setChip(v)}
          allowDeselect={false}
        />
        <Select
          size="xs"
          style={{ flex: 1, minWidth: 180 }}
          label="Image (.bin)"
          placeholder="choose a file"
          data={files.map((f) => ({ value: f.path, label: f.name }))}
          value={path}
          onChange={setPath}
          allowDeselect={false}
          nothingFoundMessage="none yet"
        />
        <FileButton onChange={(f) => void pick(f)} accept=".bin">
          {(props) => (
            <Button size="xs" variant="default" loading={busy === 'upload'} {...props}>
              Choose…
            </Button>
          )}
        </FileButton>
        <TextInput size="xs" w={110} label="Address" value={address} onChange={(e) => setAddress(e.currentTarget.value)} />
      </Group>
      {profile && pinsSet ? (
        <Text size="xs" c="dimmed" data-testid="esp-pins">
          RX LA{rx} · TX LA{tx} · BOOT LA{boot} · EN on the pod&apos;s reset pin, from the pins profile.{' '}
          <HelpTip label="ESP32 wiring" docs="/docs/benchpod-targets/esp32">
            RX goes to the chip&apos;s TXD0, TX to its RXD0, BOOT to IO0 (IO9 on the C3/C6) and EN to the pod&apos;s
            reset pin.
          </HelpTip>
        </Text>
      ) : profile ? (
        <Alert color="yellow" variant="light" p="xs" data-testid="esp-no-pins">
          <Text size="xs">
            Set UART RX, UART TX and a signal named BOOT (on the chip&apos;s IO0, IO9 on the C3/C6) in the Pins tab before
            flashing.
          </Text>
        </Alert>
      ) : null}
      <Group gap="xs">
        <Button size="xs" onClick={() => void flash()} loading={busy === 'flash'} disabled={!path || !!busy || !pinsSet}>
          Flash
        </Button>
      </Group>
      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}
      {result ? (
        <Alert color={result.ok ? 'green' : 'red'} variant="light" p="xs" title={result.ok ? 'flashed' : 'flash failed'}>
          <TerminalText text={[result.stdout_tail, result.stderr_tail].filter(Boolean).join('\n')} maxHeight={240} />
        </Alert>
      ) : null}
    </Stack>
  )
}

export type FlashMode = 'swd' | 'spi' | 'uart'
const MODE_KEY = 'benchpod.flashMode'

/**
 * The Flash tab: a switcher for what to flash (the board over SWD, a SPI flash chip, an ESP32 over
 * its UART) and the matching controls. The choice is remembered.
 */
export function FlashModes({ swd, spi, uart }: { swd: ReactNode; spi: ReactNode; uart: ReactNode }) {
  const [mode, setModeState] = useState<FlashMode>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY)
      return v === 'spi' || v === 'uart' ? v : 'swd'
    } catch {
      return 'swd'
    }
  })
  const setMode = (m: FlashMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* not remembered */
    }
  }
  return (
    <Stack gap={0}>
      <Group justify="flex-end" px="sm" pt="sm">
        <SegmentedControl
          size="xs"
          aria-label="What to flash"
          value={mode}
          onChange={(v) => setMode(v as FlashMode)}
          data={[
            { value: 'swd', label: 'SWD' },
            { value: 'spi', label: 'SPI flash' },
            { value: 'uart', label: 'UART (ESP32)' },
          ]}
        />
      </Group>
      {mode === 'swd' ? swd : mode === 'spi' ? spi : uart}
    </Stack>
  )
}
