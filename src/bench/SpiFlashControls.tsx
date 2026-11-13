import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Checkbox, Divider, FileButton, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { TerminalText } from '../results/ResultView'
import { benchData, benchError, type BenchCall } from './benchCall'
import type { FirmwareFile, FirmwareStore } from './FlashControls'

// An SPI NOR flash chip (a 25-series part) on four LA pins, by hand: the web app's SPI flash panel
// for a host's bench panel. The pins come from the wiring (spi_sclk/mosi/miso/cs). Program writes
// a raw image the host stored (the same store as the firmware files); Read shows up to 4 KB as
// hex, or writes a longer read to a file in the host's folder.

type Info = { jedec_id: string; present: boolean; size: number; status: number; hz: number }
type Program = { jedec_id: string; addr: number; length: number; erased: number; verified: boolean; seconds: number }
type Read = { addr: number; length: number; file: string; hex: string }

const RATES = [
  { value: '1000000', label: '1 MHz' },
  { value: '3000000', label: '3 MHz' },
  { value: '6000000', label: '6 MHz' },
]
/** The most a read returns inline; longer reads go to a file. */
const INLINE_MAX = 4096

/** "0x1000", "4096" or "4k" as a byte address; NaN when it is none of those. */
export function parseSpiAddr(s: string): number {
  const t = s.trim().toLowerCase()
  if (/^0x[0-9a-f]+$/.test(t)) return parseInt(t.slice(2), 16)
  const k = /^(\d+)\s*k$/.exec(t)
  if (k) return Number(k[1]) * 1024
  return /^\d+$/.test(t) ? Number(t) : NaN
}

/** Hex dump lines: address, 16 bytes, ASCII. */
export function hexDump(hex: string, base: number): string {
  const bytes = hex.match(/../g) ?? []
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.slice(i, i + 16)
    const ascii = row.map((b) => {
      const c = parseInt(b, 16)
      return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.'
    })
    lines.push(`${(base + i).toString(16).padStart(6, '0')}  ${row.join(' ').padEnd(47)}  ${ascii.join('')}`)
  }
  return lines.join('\n')
}

function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(n % (1 << 20) ? 1 : 0)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function SpiFlashControls({ call, images, dumpDir }: { call: BenchCall; images: FirmwareStore; dumpDir?: string }) {
  const [hz, setHz] = useState('1000000')
  const [holdReset, setHoldReset] = useState(true)
  const [info, setInfo] = useState<Info | null>(null)
  const [files, setFiles] = useState<FirmwareFile[]>([])
  const [path, setPath] = useState<string | null>(null)
  const [addr, setAddr] = useState('0x0')
  const [readAddr, setReadAddr] = useState('0x0')
  const [readLen, setReadLen] = useState<number | ''>(256)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [program, setProgram] = useState<Program | null>(null)
  const [read, setRead] = useState<Read | null>(null)

  const loadFiles = useCallback(async () => {
    try {
      const f = (await images.recent()).filter((x) => /\.bin$/i.test(x.name))
      setFiles(f)
      setPath((p) => p ?? f[0]?.path ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [images])
  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const run = async <T,>(what: string, tool: string, args: Record<string, unknown>): Promise<T | undefined> => {
    setBusy(what)
    setError(undefined)
    try {
      const r = await call(tool, { ...args, hz: Number(hz) })
      const e = benchError(r)
      if (e) setError(e)
      return benchData<T>(r)
    } finally {
      setBusy(null)
    }
  }

  const identify = async () => setInfo((await run<Info>('info', 'spi_flash_info', {})) ?? null)

  const pick = async (f: File | null) => {
    if (!f) return
    setBusy('upload')
    try {
      const up = await images.upload(f)
      await loadFiles()
      setPath(up.path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const a = parseSpiAddr(addr)
  const write = async () => {
    if (!path || Number.isNaN(a)) return
    setProgram(null)
    const r = await run<Program>('program', 'spi_flash_program', { file: path, addr: a, hold_reset: holdReset })
    if (r) setProgram(r)
  }

  const ra = parseSpiAddr(readAddr)
  const n = Number(readLen) || 0
  const toFile = n > INLINE_MAX
  const doRead = async () => {
    if (Number.isNaN(ra) || n <= 0) return
    setRead(null)
    const args: Record<string, unknown> = { addr: ra, length: n }
    if (toFile && dumpDir) args.file = `${dumpDir}/spi-flash-0x${ra.toString(16)}-${n}.bin`
    const r = await run<Read>('read', 'spi_flash_read', args)
    if (r) setRead(r)
  }

  return (
    <Stack gap="sm" p="sm">
      <Text size="xs" c="dimmed">
        A 25-series SPI NOR flash on the SPI pins of the wiring (SCLK, MOSI, MISO, CS). Hold the board in reset so its own controller
        stays off the bus.
      </Text>
      <Group gap="xs" align="flex-end">
        <Select size="xs" w={100} label="SCK rate" data={RATES} value={hz} onChange={(v) => v && setHz(v)} allowDeselect={false} />
        <Checkbox size="xs" mb={6} label="Hold the board in reset" checked={holdReset} onChange={(e) => setHoldReset(e.currentTarget.checked)} />
        <Button size="xs" variant="light" onClick={() => void identify()} loading={busy === 'info'} disabled={!!busy}>
          Identify chip
        </Button>
      </Group>
      {info ? (
        <Group gap="xs">
          <Badge color={info.present ? 'green' : 'red'} variant="light">
            {info.present ? 'chip found' : 'no chip'}
          </Badge>
          <Text size="xs" ff="monospace">
            JEDEC {info.jedec_id}
            {info.size ? ` · ${fmtBytes(info.size)}` : ''} · status 0x{info.status.toString(16).padStart(2, '0')} · {Math.round(info.hz / 1000)} kHz
          </Text>
        </Group>
      ) : null}

      <Divider label="Program" labelPosition="left" />
      <Group gap="xs" align="flex-end">
        <Select
          size="xs"
          style={{ flex: 1, minWidth: 200 }}
          label="Image (raw .bin)"
          placeholder="choose a file"
          data={files.map((f) => ({ value: f.path, label: `${f.name} · ${fmtBytes(f.size)}` }))}
          value={path}
          onChange={setPath}
          allowDeselect={false}
        />
        <FileButton onChange={(f) => void pick(f)} accept=".bin">
          {(props) => (
            <Button size="xs" variant="default" loading={busy === 'upload'} {...props}>
              Choose…
            </Button>
          )}
        </FileButton>
        <TextInput size="xs" w={110} label="Start address" value={addr} onChange={(e) => setAddr(e.currentTarget.value)} error={Number.isNaN(a) ? 'hex or bytes' : undefined} />
        <Button size="xs" onClick={() => void write()} loading={busy === 'program'} disabled={!path || Number.isNaN(a) || !!busy}>
          Erase, write, verify
        </Button>
      </Group>
      {program ? (
        <Text size="xs" c={program.verified ? 'teal' : 'red'} ff="monospace">
          {program.verified ? 'written and verified' : 'written, not verified'}: {fmtBytes(program.length)} at 0x{program.addr.toString(16)}, {fmtBytes(program.erased)}{' '}
          erased, {program.seconds.toFixed(1)} s
        </Text>
      ) : null}

      <Divider label="Read" labelPosition="left" />
      <Group gap="xs" align="flex-end">
        <TextInput size="xs" w={110} label="Address" value={readAddr} onChange={(e) => setReadAddr(e.currentTarget.value)} error={Number.isNaN(ra) ? 'hex or bytes' : undefined} />
        <NumberInput size="xs" w={120} label="Bytes" value={readLen} onChange={(v) => setReadLen(typeof v === 'number' ? v : '')} min={1} max={16 << 20} hideControls />
        <Button size="xs" variant="light" onClick={() => void doRead()} loading={busy === 'read'} disabled={Number.isNaN(ra) || n <= 0 || (toFile && !dumpDir) || !!busy}>
          Read
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {toFile ? (dumpDir ? `More than 4 KB: saved as a file in ${dumpDir}.` : 'Up to 4 KB here.') : 'Up to 4 KB shows here; more is saved as a file.'}
      </Text>
      {read?.hex ? <TerminalText text={hexDump(read.hex, read.addr)} maxHeight={300} /> : null}
      {read?.file ? (
        <Text size="xs" ff="monospace">
          saved {fmtBytes(read.length)} to {read.file}
        </Text>
      ) : null}

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}
    </Stack>
  )
}
