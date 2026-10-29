import { useEffect, useState } from 'react'
import { Box, SimpleGrid, Stack, Text } from '@mantine/core'

/** A tool the agent may use (GET {base}/tools): its MCP name and the first sentence of its description. */
export type ToolInfo = { name: string; summary: string }

const GROUPS: { title: string; match: (n: string) => boolean }[] = [
  { title: 'Bench', match: (n) => ['status', 'wiring', 'set_wiring', 'calibration', 'cloud_list_devices', 'connect', 'disconnect', 'lan_tls', 'usb_network', 'command', 'fpga_image'].includes(n) },
  { title: 'Power and reset', match: (n) => /^(power_|measure_power|reset_target)/.test(n) },
  { title: 'Firmware', match: (n) => /^(flash|spi_)/.test(n) },
  { title: 'UART console', match: (n) => /^(uart_|capture_uart)/.test(n) },
  { title: 'Sensor emulation', match: (n) => /(i2c_sensor|_gps|gps_|set_pull|pull_status)/.test(n) },
  { title: 'Logic and GPIO', match: (n) => /^(capture_la|decode_la|la_|gpio_|capture_correlated)/.test(n) },
  { title: 'Analog', match: (n) => /^(dac_|adc_|capture_adc|generate|replay|list_waveforms|current_out|control_loop|loop_|analog_path|calibrate|save_capture)/.test(n) },
  { title: 'CAN', match: (n) => /^can_/.test(n) },
]

/** Tools grouped by what they work on, in the order of GROUPS; unknown ones under "Other". */
export function groupTools(tools: ToolInfo[]): { title: string; tools: ToolInfo[] }[] {
  const out = GROUPS.map((g) => ({ title: g.title, tools: [] as ToolInfo[] }))
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

/** The agent's tools by group: name in monospace, what it does beside it. */
export function ToolsList({ tools, columns = 2 }: { tools: ToolInfo[]; columns?: number }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: columns }} spacing="md" verticalSpacing="md">
      {groupTools(tools).map((g) => (
        <Box key={g.title}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
            {g.title}
          </Text>
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
  )
}
