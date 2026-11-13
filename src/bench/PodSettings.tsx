import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Divider, Group, PasswordInput, SegmentedControl, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { TerminalText } from '../results/ResultView'
import { benchData, benchError, type BenchCall, type BenchResult } from './benchCall'

// The pod's own settings, the web app's Settings tab for a host's bench panel: an overview, its
// network (Wi-Fi, LAN access, HTTPS-only, the USB network adapter), the signature policy, and
// deregistering. `call` runs the MCP tools (status, lan_tls); `podCall` runs the host's pod
// commands (the desktop app: the benchpod CLI's show-network, scan-wifi, set-wifi, clear-wifi,
// lan-policy, usb-network, sig-policy, deregister), with the same answer shape and confirmations.

type Status = {
  connection?: string
  kind?: string
  la_voltage?: number | null
  firmware?: {
    version?: string
    gateware?: number
    board_rev?: string
    ip?: string
    cloud?: string
    wifi?: string
    lan_policy?: string
    sig_policy?: string
    psram?: string
    usb?: { setting?: string; link?: boolean; ip?: string; host_ip?: string }
    lan_tls?: { https_only?: boolean; sha256?: string }
  }
}

const KINDS: Record<string, string> = { usb_net: 'USB (network adapter)', serial: 'USB (console only)', tcp: 'network', discover: 'network', embeddedci: 'embeddedci.com' }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Table.Tr>
      <Table.Td c="dimmed" w={170}>
        {label}
      </Table.Td>
      <Table.Td>{children}</Table.Td>
    </Table.Tr>
  )
}

export function PodSettings({ call, podCall, offline }: { call: BenchCall; podCall: BenchCall; offline?: boolean }) {
  const [st, setSt] = useState<Status | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null)
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')

  const load = useCallback(async () => {
    const r = await call('status', {}, { poll: true })
    const s = benchData<Status>(r)
    if (s) setSt(s)
    else setError(benchError(r))
  }, [call])
  useEffect(() => {
    void load()
  }, [load])

  /** Run one command; show its text under the section, reload the overview after a change. */
  const run = async (what: string, f: () => Promise<BenchResult>, show = true, reload = true) => {
    setBusy(what)
    setError(undefined)
    try {
      const r = await f()
      if (r.declined) return r
      const e = benchError(r)
      if (e) setError(e)
      else if (show) setOutput({ title: what, text: r.text || 'done' })
      if (reload) await load()
      return r
    } finally {
      setBusy(null)
    }
  }

  const fw = st?.firmware ?? {}
  const httpsOnly = !!fw.lan_tls?.https_only
  const usbOn = fw.usb?.setting !== 'off'

  return (
    <Stack gap="sm" p="sm">
      <Group justify="space-between">
        <Text fw={600}>This pod</Text>
        <Button size="compact-xs" variant="subtle" onClick={() => void load()} disabled={!!busy}>
          Refresh
        </Button>
      </Group>
      {st ? (
        <Table fz="xs" verticalSpacing={4}>
          <Table.Tbody>
            <Row label="Board">{fw.board_rev ?? 'unknown'}</Row>
            <Row label="Firmware">
              {fw.version ?? '?'}
              {fw.gateware ? ` · gateware ${fw.gateware}` : ''}
            </Row>
            <Row label="Connected through">
              {KINDS[st.kind ?? ''] ?? st.kind ?? 'not connected'}
              {st.connection ? ` (${st.connection})` : ''}
            </Row>
            <Row label="Network address">{fw.ip && fw.ip !== '0.0.0.0' ? fw.ip : 'none (no Ethernet or Wi-Fi link)'}</Row>
            <Row label="USB network adapter">
              {usbOn ? 'on' : 'off'}
              {fw.usb?.ip ? ` · ${fw.usb.ip}` : ''}
            </Row>
            <Row label="Wi-Fi">{fw.wifi ?? 'unknown'}</Row>
            <Row label="I/O voltage">{st.la_voltage ? `${st.la_voltage} V` : 'not set'}</Row>
            <Row label="embeddedci.com">{fw.cloud ?? 'unknown'}</Row>
          </Table.Tbody>
        </Table>
      ) : (
        <Text size="sm" c="dimmed">
          Connect the pod to see its settings.
        </Text>
      )}

      <Divider label="Wi-Fi" labelPosition="left" />
      <Text size="xs" c="dimmed">
        Over the pod's USB console. Joining Wi-Fi turns its USB network adapter off: the app then reaches it over Wi-Fi or the console.
      </Text>
      <Group gap="xs">
        <Button size="xs" variant="light" onClick={() => void run('Network', () => podCall('show-network'), true, false)} loading={busy === 'Network'} disabled={!!busy}>
          Show network
        </Button>
        <Button size="xs" variant="light" onClick={() => void run('Networks the pod sees', () => podCall('scan-wifi'), true, false)} loading={busy === 'Networks the pod sees'} disabled={!!busy}>
          Scan
        </Button>
        <Button size="xs" variant="subtle" color="red" onClick={() => void run('Forget Wi-Fi', () => podCall('clear-wifi'))} loading={busy === 'Forget Wi-Fi'} disabled={!!busy}>
          Forget Wi-Fi
        </Button>
      </Group>
      <Group gap="xs" align="flex-end">
        <TextInput size="xs" style={{ flex: 1 }} label="Network name (SSID)" value={ssid} onChange={(e) => setSsid(e.currentTarget.value)} />
        <PasswordInput size="xs" style={{ flex: 1 }} label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="new-password" />
        <Button
          size="xs"
          disabled={!ssid.trim() || !!busy}
          loading={busy === 'Join'}
          onClick={() =>
            void run('Join', () => podCall('set-wifi', { ssid: ssid.trim(), password })).then((r) => {
              if (r && !r.is_error && !r.declined) setPassword('')
            })
          }
        >
          Join
        </Button>
      </Group>

      <Divider label="Network access" labelPosition="left" />
      <Group gap="md" align="flex-end">
        <Stack gap={2}>
          <Text size="xs" fw={500}>
            On Ethernet and Wi-Fi
          </Text>
          <SegmentedControl
            size="xs"
            value={fw.lan_policy ?? 'open'}
            disabled={!st || !!busy}
            onChange={(v) => void run('Network access', () => podCall('lan-policy', { set: v }), false)}
            data={[
              { value: 'open', label: 'Open' },
              { value: 'locked', label: 'Locked' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Stack>
        <Switch
          size="xs"
          label="HTTPS only (TLS on 8443)"
          checked={httpsOnly}
          disabled={!st || !!busy}
          onChange={(e) => {
            const on = e.currentTarget.checked
            void run('HTTPS only', () => call('lan_tls', { https_only: on }), false)
          }}
        />
        <Switch
          size="xs"
          label="USB network adapter"
          checked={usbOn}
          disabled={!st || !!busy}
          onChange={(e) => {
            const on = e.currentTarget.checked
            void run('USB network adapter', () => podCall('usb-network', { set: on ? 'on' : 'off' }), false)
          }}
        />
      </Group>
      <Text size="xs" c="dimmed">
        Locked: read and instrument control on the LAN, settings and firmware only over USB. Off: the pod stops listening on the LAN. The USB
        link always works. Turning the USB network adapter off leaves the USB console only (no captures over USB).
      </Text>

      <Divider label="Firmware signatures" labelPosition="left" />
      <SegmentedControl
        size="xs"
        w="fit-content"
        value={fw.sig_policy ?? 'audit'}
        disabled={!st || !!busy}
        onChange={(v) => void run('Signature policy', () => podCall('sig-policy', { set: v }), false)}
        data={[
          { value: 'audit', label: 'Audit' },
          { value: 'permissive', label: 'Permissive' },
          { value: 'required', label: 'Required' },
        ]}
      />
      <Text size="xs" c="dimmed">
        Audit accepts every image and reports its signature; permissive refuses a bad signature; required refuses unsigned images too.
      </Text>

      {!offline ? (
        <>
          <Divider label="embeddedci.com" labelPosition="left" />
          <Group gap="xs">
            <Button size="xs" variant="subtle" color="red" onClick={() => void run('Deregister', () => podCall('deregister'))} loading={busy === 'Deregister'} disabled={!!busy}>
              Deregister this pod
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Removes the pod from your embeddedci.com account (its data stays there) and stops it connecting. Needs `benchpod login` on this
            computer. The app keeps working with the pod over USB and your network.
          </Text>
        </>
      ) : null}

      {error ? (
        <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(undefined)}>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Text>
        </Alert>
      ) : null}
      {output ? (
        <Stack gap={4}>
          <Text size="xs" fw={600}>
            {output.title}
          </Text>
          <TerminalText text={output.text} maxHeight={260} />
        </Stack>
      ) : null}
    </Stack>
  )
}
