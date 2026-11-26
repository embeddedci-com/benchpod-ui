import { useMemo, useRef } from 'react'
import { Button, Group, Stack, Text } from '@mantine/core'
import { laChannelMap, LA_CHANNEL_COUNT, railLabel, type Wiring, type WiringRole } from './model'

// The wiring profile drawn: the pod's LA channels on the left, what each is wired to on the right,
// one line per wire colored by what it carries, the I/O voltage and power rail on top. A channel
// whose wiring is not saved yet is drawn dashed. Export as SVG to keep next to the bench.

type Kind = 'swd' | 'jtag' | 'uart' | 'i2c' | 'spi' | 'signal'

const KIND_COLORS: Record<Kind, string> = {
  swd: 'var(--mantine-color-violet-6)',
  jtag: 'var(--mantine-color-indigo-6)',
  uart: 'var(--mantine-color-blue-6)',
  i2c: 'var(--mantine-color-teal-6)',
  spi: 'var(--mantine-color-orange-6)',
  signal: 'var(--mantine-color-cyan-6)',
}

const KIND_LABELS: Record<Kind, string> = { swd: 'SWD', jtag: 'JTAG', uart: 'UART', i2c: 'I2C', spi: 'SPI', signal: 'Signal' }

function roleKind(role: string): Kind {
  if (role.startsWith('swd_')) return 'swd'
  if (role.startsWith('jtag_')) return 'jtag'
  if (role.startsWith('uart_')) return 'uart'
  if (role.startsWith('i2c_')) return 'i2c'
  if (role.startsWith('spi_')) return 'spi'
  return 'signal'
}

const ROW = 26
const TOP = 60
const LEFT_W = 92
const RIGHT_X = 300
const WIDTH = 460

export function WiringDiagram({
  wiring,
  changed,
  title,
}: {
  wiring: Wiring
  /** LA channels whose wiring differs from the saved profile: drawn dashed. */
  changed?: ReadonlySet<number>
  /** Shown above the drawing, e.g. the profile's name. */
  title?: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const channels = useMemo(() => laChannelMap(wiring), [wiring])
  const height = TOP + LA_CHANNEL_COUNT * ROW + 16
  const io = wiring.la_mv ? `${wiring.la_mv / 1000} V` : 'not set'
  const rail = railLabel(wiring.efuse)
  const kinds = new Set<Kind>()

  const exportSvg = () => {
    const el = svgRef.current
    if (!el) return
    const text = new XMLSerializer().serializeToString(el)
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || 'wiring'}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Stack gap={6}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        role="img"
        aria-label={`Wiring diagram${title ? ` of ${title}` : ''}`}
        style={{ maxWidth: WIDTH, fontFamily: 'var(--mantine-font-family)' }}
      >
        <text x={0} y={16} fontSize={13} fontWeight={700} fill="var(--mantine-color-text)">
          {title || 'Wiring'}
        </text>
        <text x={0} y={34} fontSize={11} fill="var(--mantine-color-dimmed)">
          {`I/O voltage ${io}, target power ${rail}`}
        </text>
        <text x={LEFT_W / 2} y={TOP - 4} fontSize={10} textAnchor="middle" fill="var(--mantine-color-dimmed)">
          BenchPod
        </text>
        <text x={RIGHT_X} y={TOP - 4} fontSize={10} fill="var(--mantine-color-dimmed)">
          Your board
        </text>
        {channels.map((ch, i) => {
          const y = TOP + i * ROW + ROW / 2
          const user = ch.users[0]
          const kind = user ? roleKind(user.kind === 'role' ? (user.id as WiringRole) : 'signal') : undefined
          if (kind) kinds.add(kind)
          const color = kind ? KIND_COLORS[kind] : 'var(--mantine-color-gray-4)'
          const dashed = changed?.has(ch.la)
          return (
            <g key={ch.la}>
              <rect x={0} y={y - 10} width={LEFT_W} height={20} rx={3} fill="none" stroke="var(--mantine-color-default-border)" />
              <text x={8} y={y + 4} fontSize={11} fontWeight={700} fontFamily="var(--mantine-font-family-monospace)" fill="var(--mantine-color-text)">
                {`LA${ch.la}`}
              </text>
              {user ? (
                <>
                  <line
                    x1={LEFT_W}
                    y1={y}
                    x2={RIGHT_X - 8}
                    y2={y}
                    stroke={ch.conflict ? 'var(--mantine-color-red-6)' : color}
                    strokeWidth={2}
                    strokeDasharray={dashed ? '6 4' : undefined}
                  />
                  <circle cx={RIGHT_X - 8} cy={y} r={3} fill={color} />
                  <text x={RIGHT_X} y={y + 4} fontSize={11} fill={ch.conflict ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-text)'}>
                    {ch.users.map((u) => u.label).join(' / ')}
                    {dashed ? ' (not saved)' : ''}
                  </text>
                </>
              ) : (
                <text x={LEFT_W + 10} y={y + 4} fontSize={10} fill="var(--mantine-color-dimmed)">
                  not wired
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Group gap={10} wrap="wrap">
          {(Object.keys(KIND_COLORS) as Kind[])
            .filter((k) => kinds.has(k))
            .map((k) => (
              <Group key={k} gap={4} wrap="nowrap">
                <span style={{ width: 12, height: 3, background: KIND_COLORS[k], display: 'inline-block' }} />
                <Text size="xs">{KIND_LABELS[k]}</Text>
              </Group>
            ))}
          {changed && changed.size > 0 ? (
            <Text size="xs" c="dimmed">
              Dashed: not saved yet
            </Text>
          ) : null}
        </Group>
        <Button size="compact-xs" variant="subtle" onClick={exportSvg}>
          Export SVG
        </Button>
      </Group>
    </Stack>
  )
}

/** LA channels whose user differs between two profiles (the editor's draft and the saved one). */
export function changedChannels(draft: Wiring, saved: Wiring): Set<number> {
  const a = laChannelMap(draft)
  const b = laChannelMap(saved)
  const out = new Set<number>()
  for (let i = 0; i < a.length; i += 1) {
    const ua = a[i].users.map((u) => u.label).join('/')
    const ub = b[i]?.users.map((u) => u.label).join('/') ?? ''
    if (ua !== ub) out.add(a[i].la)
  }
  return out
}
