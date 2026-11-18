import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Box, Button, Group, Select, Stack, Switch, Text, useComputedColorScheme } from '@mantine/core'
import { fmtSi } from '../results/AdcEnvelope'
import { benchData, benchError, type BenchCall } from './benchCall'

// Target power by hand: each rail's switch, its voltage and the current the board draws, read
// live with a minute of history. The web app's Power tab, for a host's bench panel.

type Rail = { enabled: boolean; fault: boolean; bus_voltage: number; current: number; monitor_ok?: boolean }
export type PowerStatus = {
  internal: Rail
  external: Rail
  pod?: { monitor_ok: boolean; bus_voltage: number; current: number; total_current?: number | null } | null
}

const RAILS = [
  { key: 'internal' as const, efuse: 1, label: 'Internal 5 V', hint: 'eFuse 1, from the pod' },
  { key: 'external' as const, efuse: 2, label: 'External', hint: 'eFuse 2, from your supply' },
]

/** How often the reading refreshes, and how much of it the chart keeps. */
const POLL_MS = 1000
const HISTORY = 60

/** What the MCP `wiring` tool reports about the profile and the pod's stored profiles. */
type WiringInfo = {
  profile_name?: string
  la_voltage?: number | null
  efuse?: number | null
  default_profile?: string | null
  profiles?: { name: string; rev: number }[]
}

const railName = (efuse?: number | null) => (efuse === 1 ? 'internal 5 V' : efuse === 2 ? 'external' : 'not set')

export function PowerControls({ call, pollMs = POLL_MS }: { call: BenchCall; pollMs?: number }) {
  const [status, setStatus] = useState<PowerStatus | null>(null)
  // Powering the board on always goes with a wiring profile: its I/O voltage is set first.
  const [wiring, setWiring] = useState<WiringInfo | null>(null)
  const [profile, setProfile] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ efuse: number; why: string } | null>(null)
  const [askRestart, setAskRestart] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState<number | null>(null)
  const [history, setHistory] = useState<{ internal: number; external: number }[]>([])
  const alive = useRef(true)

  const read = async () => {
    const r = await call('power_status', {}, { poll: true })
    if (!alive.current) return
    const s = benchData<PowerStatus>(r)
    if (s?.internal && s.external) {
      setStatus(s)
      setError(undefined)
      setHistory((h) => [...h, { internal: s.internal.enabled ? s.internal.current : 0, external: s.external.enabled ? s.external.current : 0 }].slice(-HISTORY))
    } else setError(benchError(r))
  }

  const readWiring = async () => {
    const w = benchData<WiringInfo>(await call('wiring', {}))
    if (!alive.current || !w) return
    setWiring(w)
    setProfile((p) => p ?? (w.profile_name || w.default_profile || null))
  }
  useEffect(() => {
    void readWiring()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call])

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // One read at a time: a read waits behind a long agent call, and must not pile up.
    const loop = async () => {
      await read()
      if (alive.current) timer = setTimeout(loop, pollMs)
    }
    void loop()
    return () => {
      alive.current = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, pollMs])

  const toggle = async (efuse: number, on: boolean, confirmed = false) => {
    // Ask only when something does not match, so the normal case stays one click.
    if (on && !confirmed && wiring?.efuse && wiring.efuse !== efuse && (!profile || profile === wiring.profile_name)) {
      setConfirm({ efuse, why: `The pins profile's rail is ${railName(wiring.efuse)}, not ${railName(efuse)}.` })
      return
    }
    setConfirm(null)
    setBusy(efuse)
    try {
      const args: Record<string, unknown> = { efuse }
      if (on && profile && wiring?.profiles?.length) args.wiring_profile = profile
      const r = await call(on ? 'power_on' : 'power_off', args)
      const e = benchError(r)
      if (e) setError(e)
      await read()
      if (on) await readWiring()
    } finally {
      setBusy(null)
    }
  }
  // Restart the board: the rail that is on goes off, then on again with the chosen profile.
  const restart = async () => {
    setAskRestart(false)
    const efuse = status?.internal.enabled ? 1 : 2
    setBusy(efuse)
    try {
      // One yes (the Restart question above) covers both calls.
      const off = await call('power_off', { efuse }, { approved: true })
      const e = benchError(off)
      if (e) {
        setError(e)
        return
      }
      await new Promise((r) => setTimeout(r, 500))
      const args: Record<string, unknown> = { efuse }
      if (profile && wiring?.profiles?.length) args.wiring_profile = profile
      const r = await call('power_on', args, { approved: true })
      const e2 = benchError(r)
      if (e2) setError(e2)
      await read()
    } finally {
      setBusy(null)
    }
  }
  const anyOn = !!(status?.internal.enabled || status?.external.enabled)
  const profiles = wiring?.profiles ?? []

  return (
    <Stack gap="sm" p="sm">
      <Group gap="xs" align="flex-end" wrap="wrap">
        {profiles.length ? (
          <Select
            size="xs"
            label="Power on with pins profile"
            w={200}
            data={profiles.map((p) => ({ value: p.name, label: p.name === wiring?.default_profile ? `${p.name} (default)` : p.name }))}
            value={profile}
            onChange={setProfile}
            allowDeselect={false}
            disabled={busy !== null}
          />
        ) : null}
        <Text size="xs" c="dimmed" pb={4}>
          {wiring
            ? `${wiring.profile_name ? `Pins ${wiring.profile_name}: ` : ''}I/O ${wiring.la_voltage ? `${wiring.la_voltage} V` : 'not set'}, rail ${railName(wiring.efuse)}`
            : ''}
        </Text>
      </Group>
      {confirm ? (
        <Alert color="orange" variant="light" p="xs">
          <Group gap="xs" justify="space-between" wrap="wrap">
            <Text size="xs">{confirm.why} Power on anyway?</Text>
            <Group gap={6}>
              <Button size="compact-xs" onClick={() => void toggle(confirm.efuse, true, true)}>
                Power on
              </Button>
              <Button size="compact-xs" variant="subtle" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </Group>
          </Group>
        </Alert>
      ) : null}
      {RAILS.map((rail) => {
        const r = status?.[rail.key]
        return (
          <Group key={rail.key} justify="space-between" wrap="nowrap" align="center">
            <Switch
              label={rail.label}
              description={rail.hint}
              checked={!!r?.enabled}
              disabled={!status || busy !== null}
              onChange={(e) => void toggle(rail.efuse, e.currentTarget.checked)}
              color={r?.fault ? 'red' : undefined}
            />
            <Group gap="sm" wrap="nowrap">
              {r?.fault ? (
                <Badge color="red" variant="light">
                  fault
                </Badge>
              ) : null}
              <Text ff="monospace" size="lg" fw={600} c={r?.enabled ? undefined : 'dimmed'} aria-label={`${rail.label} current`}>
                {r ? fmtSi(r.enabled ? r.current : 0, 'A') : '…'}
              </Text>
              <Text ff="monospace" size="sm" c="dimmed" w={64} ta="right">
                {r ? fmtSi(r.bus_voltage, 'V') : ''}
              </Text>
            </Group>
          </Group>
        )
      })}
      {anyOn ? (
        <Group>
          <Button size="compact-xs" variant="light" onClick={() => setAskRestart(true)} loading={busy !== null} data-testid="restart-board">
            Restart board
          </Button>
        </Group>
      ) : null}
      {askRestart ? (
        <Alert color="blue" variant="light" p="xs">
          <Group gap="xs" justify="space-between" wrap="wrap">
            <Text size="xs">Restart the board: power off and on again{profile ? ` with ${profile}` : ''}?</Text>
            <Group gap={6}>
              <Button size="compact-xs" onClick={() => void restart()} data-testid="restart-confirm">
                Restart
              </Button>
              <Button size="compact-xs" variant="subtle" onClick={() => setAskRestart(false)}>
                Cancel
              </Button>
            </Group>
          </Group>
        </Alert>
      ) : null}
      {history.length > 1 ? <CurrentChart history={history} /> : null}
      {status?.pod?.monitor_ok ? (
        <Text size="xs" c="dimmed" ff="monospace">
          pod draw {fmtSi(status.pod.current, 'A')}
          {status.pod.total_current != null ? ` · total from USB-C ${fmtSi(status.pod.total_current, 'A')}` : ''}
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

/** The last minute of current on both rails, one line each. */
function CurrentChart({ history }: { history: { internal: number; external: number }[] }) {
  const dark = useComputedColorScheme('dark') === 'dark'
  const w = 320
  const h = 80
  const max = Math.max(0.001, ...history.map((p) => Math.max(p.internal, p.external)))
  const line = (k: 'internal' | 'external') =>
    history.map((p, i) => `${i === 0 ? 'M' : 'L'}${(w - ((history.length - 1 - i) / (HISTORY - 1)) * w).toFixed(1)},${(h - (p[k] / max) * (h - 4) - 2).toFixed(1)}`).join(' ')
  return (
    <Box>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Current over the last minute">
        <rect x={0} y={0} width={w} height={h} fill={dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'} />
        <path d={line('internal')} fill="none" stroke="var(--mantine-color-orange-5)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={line('external')} fill="none" stroke="var(--mantine-color-blue-5)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          last minute · peak {fmtSi(max, 'A')}
        </Text>
        <Group gap="xs">
          <Text size="xs" c="orange.5">
            internal
          </Text>
          <Text size="xs" c="blue.5">
            external
          </Text>
        </Group>
      </Group>
    </Box>
  )
}
