import { useEffect, useState } from 'react'
import { Anchor, Box, SimpleGrid, Stack, Text } from '@mantine/core'

/** A tool the agent may use (GET {base}/tools): its MCP name and the first sentence of its description. */
export type ToolInfo = { name: string; summary: string }

// Each group with a request that uses it: people ask in plain words, the names are for reference.
const GROUPS: { title: string; ask: string; match: (n: string) => boolean }[] = [
  { title: 'Bench', ask: 'What is wired to this pod?', match: (n) => ['status', 'wiring', 'set_wiring', 'calibration', 'cloud_list_devices', 'connect', 'disconnect', 'lan_tls', 'usb_network', 'command', 'fpga_image'].includes(n) },
  { title: 'Power and reset', ask: 'Power-cycle the board and show me its boot log.', match: (n) => /^(power_|measure_power|reset_target)/.test(n) },
  { title: 'Firmware', ask: 'Flash build/app.elf and check it boots.', match: (n) => /^(flash|spi_)/.test(n) },
  { title: 'UART console', ask: 'Run the info command on the console.', match: (n) => /^(uart_|capture_uart)/.test(n) },
  { title: 'Sensor emulation', ask: 'Emulate a BMP280 at 30 °C.', match: (n) => /(i2c_sensor|_gps|gps_|set_pull|pull_status)/.test(n) },
  { title: 'Logic and GPIO', ask: 'Capture the I2C lines and decode them.', match: (n) => /^(capture_la|decode_la|la_|gpio_|capture_correlated)/.test(n) },
  { title: 'Analog', ask: 'Drive 1 V on the DAC and capture the ADC.', match: (n) => /^(dac_|adc_|capture_adc|generate|replay|list_waveforms|current_out|control_loop|loop_|analog_path|calibrate|save_capture)/.test(n) },
  { title: 'CAN', ask: 'Send a CAN frame and show the reply.', match: (n) => /^can_/.test(n) },
]

/** Tools grouped by what they work on, in the order of GROUPS; unknown ones under "Other". */
export function groupTools(tools: ToolInfo[]): { title: string; ask?: string; tools: ToolInfo[] }[] {
  const out: { title: string; ask?: string; tools: ToolInfo[] }[] = GROUPS.map((g) => ({ title: g.title, ask: g.ask, tools: [] as ToolInfo[] }))
  const other: ToolInfo[] = []
  for (const t of tools) {
    const i = GROUPS.findIndex((g) => g.match(t.name))
    if (i >= 0) out[i].tools.push(t)
    else other.push(t)
  }
  if (other.length) out.push({ title: 'Other', tools: other })
  return out.filter((g) => g.tools.length > 0)
}

/** Loads the tools the agent may use from a host's chat protocol. */
export function useTools(base: string, headers?: () => Record<string, string>): ToolInfo[] | null {
  const [tools, setTools] = useState<ToolInfo[] | null>(null)
  useEffect(() => {
    let live = true
    fetch(`${base}/tools`, { headers: headers?.(), credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { tools?: ToolInfo[] } | null) => live && setTools(b?.tools ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
    // headers is a function a host recreates each render; the list only depends on base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])
  return tools
}

/** The agent's tools by group: a request to try, then each tool's name and what it does.
 *  `referenceHref` links the full reference (parameters, units, defaults). */
export function ToolsList({ tools, columns = 2, referenceHref }: { tools: ToolInfo[]; columns?: number; referenceHref?: string }) {
  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: columns }} spacing="md" verticalSpacing="md">
        {groupTools(tools).map((g) => (
          <Box key={g.title}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={2}>
              {g.title}
            </Text>
            {g.ask ? (
              <Text size="xs" fs="italic" mb={4}>
                Try: &ldquo;{g.ask}&rdquo;
              </Text>
            ) : null}
            <Stack gap={4}>
              {g.tools.map((t) => (
                <Text key={t.name} size="xs" lh={1.35}>
                  <Text span ff="monospace" fw={600} size="xs">
                    {t.name}
                  </Text>{' '}
                  <Text span c="dimmed" size="xs">
                    {t.summary}
                  </Text>
                </Text>
              ))}
            </Stack>
          </Box>
        ))}
      </SimpleGrid>
      {referenceHref ? (
        <Anchor href={referenceHref} target="_blank" rel="noopener" size="xs">
          Full reference: each tool&apos;s parameters, units and defaults →
        </Anchor>
      ) : null}
    </Stack>
  )
}
