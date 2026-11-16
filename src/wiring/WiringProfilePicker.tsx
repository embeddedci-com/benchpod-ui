import { useState } from 'react'
import { Badge, Button, Group, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'

// The wiring profiles stored on the pod: pick one to open, make it the default, delete it, or
// start a new one. The pod keeps up to 16; one is the default (what every tool uses when it names
// none). The host app supplies the list and does the calls (the web app through embeddedci.com,
// the desktop app through the MCP tools).

export type WiringProfileItem = {
  name: string
  rev: number
  isDefault: boolean
  /** Who saved the revision shown last, when the host knows: "web", "mcp", "sdk", "cli", "pod". */
  source?: string
  /** When it was saved, ISO 8601, when the host knows. */
  updatedAt?: string
}

export const WIRING_PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

export function WiringProfilePicker({
  profiles,
  selected,
  onSelect,
  onMakeDefault,
  onDelete,
  onCreate,
  busy,
  readOnly,
}: {
  profiles: WiringProfileItem[]
  selected: string | null
  onSelect: (name: string) => void
  onMakeDefault?: (name: string) => void
  onDelete?: (name: string) => void
  /** Start a new profile with this name (the host decides what it starts from). */
  onCreate?: (name: string) => void
  busy?: boolean
  /** The pod is offline: show the last copy, allow no changes. */
  readOnly?: boolean
}) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const current = profiles.find((p) => p.name === selected)
  const nameError =
    newName && !WIRING_PROFILE_NAME_RE.test(newName)
      ? '1-40 characters: a-z, 0-9 and -, not starting with -'
      : profiles.some((p) => p.name === newName)
        ? 'the pod already has a profile with this name'
        : undefined

  return (
    <Stack gap={6}>
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select
          size="xs"
          label="Wiring profile"
          w={240}
          data={profiles.map((p) => ({ value: p.name, label: p.isDefault ? `${p.name} (default)` : p.name }))}
          value={selected}
          onChange={(v) => v && onSelect(v)}
          disabled={busy || profiles.length === 0}
          placeholder={profiles.length ? 'Pick a profile' : 'No profiles on the pod yet'}
          allowDeselect={false}
        />
        {current && !current.isDefault && onMakeDefault ? (
          <Tooltip label="Every tool that names no profile uses the default" withArrow>
            <Button size="xs" variant="light" disabled={busy || readOnly} onClick={() => onMakeDefault(current.name)}>
              Make default
            </Button>
          </Tooltip>
        ) : null}
        {current && !current.isDefault && onDelete ? (
          <Button size="xs" variant="subtle" color="red" disabled={busy || readOnly} onClick={() => onDelete(current.name)}>
            Delete
          </Button>
        ) : null}
        {onCreate && !creating ? (
          <Button size="xs" variant="subtle" disabled={busy || readOnly || profiles.length >= 16} onClick={() => setCreating(true)}>
            New profile
          </Button>
        ) : null}
      </Group>
      {creating && onCreate ? (
        <Group gap="xs" align="flex-start" wrap="wrap">
          <TextInput
            size="xs"
            w={240}
            placeholder="nrf52840-dk"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value.trim().toLowerCase())}
            error={nameError}
            aria-label="New profile name"
          />
          <Button
            size="xs"
            disabled={!newName || !!nameError || busy}
            onClick={() => {
              onCreate(newName)
              setNewName('')
              setCreating(false)
            }}
          >
            Create
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </Group>
      ) : null}
      {current ? (
        <Group gap={6}>
          {current.isDefault ? (
            <Badge size="xs" variant="light">
              default
            </Badge>
          ) : null}
          <Text size="xs" c="dimmed">
            Revision {current.rev}
            {current.source ? `, saved from ${current.source}` : ''}
            {current.updatedAt ? ` on ${new Date(current.updatedAt).toLocaleString()}` : ''}
          </Text>
        </Group>
      ) : null}
      {readOnly ? (
        <Text size="xs" c="dimmed">
          The pod is offline: this is the last copy. Profiles live on the pod, so they can be changed while it is connected.
        </Text>
      ) : null}
    </Stack>
  )
}
