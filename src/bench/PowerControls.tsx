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
  /** J1 pins 17 and 18 on a digital board v4 (null or absent elsewhere). They have no meter: on or off only. */
  j1_rails?: { v3v3: boolean; v1v8: boolean } | null
}

/** Every power output the tab can switch, by the name the power tools take (`rail`). */
type RailName = 'internal' | 'external' | 'j1_3v3' | 'j1_1v8'
const RAILS = [
  { key: 'internal' as const, rail: 'internal' as RailName, label: 'Internal 5 V', hint: 'eFuse 1, from the pod' },
  { key: 'external' as const, rail: 'external' as RailName, label: 'External', hint: 'eFuse 2, from your supply' },
]
const J1_ROWS = [
  { rail: 'j1_3v3' as RailName, field: 'v3v3' as const, label: 'J1 pin 17, +3.3 V', hint: 'switched, no current reading' },
  { rail: 'j1_1v8' as RailName, field: 'v1v8' as const, label: 'J1 pin 18, +1.8 V', hint: 'switched, no current reading' },
]

/** How often the reading refreshes, and how much of it the chart keeps. */
const POLL_MS = 1000
const HISTORY = 60

/** What the MCP `wiring` tool reports about the profile and the pod's stored profiles. */
type WiringInfo = {
  profile_name?: string
  la_voltage?: number | null
  efuse?: number | string | null
  default_profile?: string | null
  profiles?: { name: string; rev: number }[]
}

const railName = (efuse?: number | string | null) =>
  efuse === 1 || efuse === 'internal' ? 'internal 5 V' : efuse === 2 || efuse === 'external' ? 'external' : efuse === 'j1_3v3' ? 'J1 pin 17 (+3.3 V)' : efuse === 'j1_1v8' ? 'J1 pin 18 (+1.8 V)' : 'not set'
/** The power tools' arguments for a rail. The eFuse rails keep `efuse` so an older MCP server still takes them; only the J1 supplies need `rail`. */
const railArgs = (r: RailName): Record<string, unknown> => (r === 'internal' ? { efuse: 1 } : r === 'external' ? { efuse: 2 } : { rail: r })
/** The profile's rail as the name the power tools take. */
const railOf = (efuse?: number | string | null): RailName | null =>
  efuse === 1 ? 'internal' : efuse === 2 ? 'external' : efuse === 'j1_3v3' || efuse === 'j1_1v8' ? efuse : null

export function PowerControls({ call, pollMs = POLL_MS }: { call: BenchCall; pollMs?: number }) {
  const [status, setStatus] = useState<PowerStatus | null>(null)
  // Powering the board on always goes with a wiring profile: its I/O voltage is set first.
  const [wiring, setWiring] = useState<WiringInfo | null>(null)
  const [profile, setProfile] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ rail: RailName; why: string } | null>(null)
  const [askRestart, setAskRestart] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState<RailName | null>(null)
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

  const toggle = async (rail: RailName, on: boolean, confirmed = false) => {
    // Ask only when something does not match, so the normal case stays one click.
    const wanted = railOf(wiring?.efuse)
    if (on && !confirmed && wanted && wanted !== rail && (!profile || profile === wiring?.profile_name)) {
      setConfirm({ rail, why: `The pins profile's rail is ${railName(wiring?.efuse)}, not ${railName(rail)}.` })
      return
    }
    setConfirm(null)
    setBusy(rail)
    try {
      const args: Record<string, unknown> = railArgs(rail)
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
    const rail: RailName = restartRail
    setBusy(rail)
    try {
      // One yes (the Restart question above) covers both calls.
      const off = await call('power_off', railArgs(rail), { approved: true })
      const e = benchError(off)
      if (e) {
        setError(e)
        return
      }
      await new Promise((r) => setTimeout(r, 500))
      const args: Record<string, unknown> = railArgs(rail)
      if (profile && wiring?.profiles?.length) args.wiring_profile = profile
      const r = await call('power_on', args, { approved: true })
      const e2 = benchError(r)
      if (e2) setError(e2)
      await read()
    } finally {
      setBusy(null)
    }
  }
  const j1 = status?.j1_rails
  const j1On = (field: 'v3v3' | 'v1v8') => !!j1?.[field]
  const anyOn = !!(status?.internal.enabled || status?.external.enabled || j1?.v3v3 || j1?.v1v8)
  // The rail Restart cycles: an eFuse rail that is on (internal first), else the J1 supply that is on.
  const restartRail: RailName = status?.internal.enabled ? 'internal' : status?.external.enabled ? 'external' : j1?.v3v3 ? 'j1_3v3' : j1?.v1v8 ? 'j1_1v8' : 'external'
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
              <Button size="compact-xs" onClick={() => void toggle(confirm.rail, true, true)}>
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
              onChange={(e) => void toggle(rail.rail, e.currentTarget.checked)}
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
      {J1_ROWS.map((row) =>
        j1 ? (
          <Group key={row.rail} justify="space-between" wrap="nowrap" align="center">
            <Switch
              label={row.label}
              description={row.hint}
              checked={j1On(row.field)}
              disabled={busy !== null}
              onChange={(e) => void toggle(row.rail, e.currentTarget.checked)}
            />
          </Group>
        ) : null,
      )}
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
