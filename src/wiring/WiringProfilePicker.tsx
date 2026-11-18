import { useState, type ReactNode } from 'react'
import { ActionIcon, Badge, Button, Group, Menu, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'

// The wiring profiles stored on the pod, in one row: pick the one to look at and edit, see which
// is active (the pod's default: powering the board on uses it, and so does every tool that names
// no profile), make another one active, start a new one, delete one. The host's extras (copy as
// JSON, the diagram) sit in the ⋯ menu. The host supplies the list and does the calls (the web app
// through embeddedci.com, the desktop app through the MCP tools).

export type WiringProfileItem = {
  name: string
  rev: number
  /** The active profile: the pod's default. */
  isDefault: boolean
  /** Who saved the revision shown last, when the host knows: "web", "mcp", "sdk", "cli", "pod". */
  source?: string
  /** When it was saved, ISO 8601, when the host knows. */
  updatedAt?: string
}

export const WIRING_PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
export const MAX_WIRING_PROFILES = 16

/** How a new profile starts: a copy of the one on screen, or with nothing wired. */
export type NewProfileFrom = 'copy' | 'empty'

export function WiringProfilePicker({
  profiles,
  selected,
  onSelect,
  onMakeDefault,
  onDelete,
  onCreate,
  menu,
  busy,
  readOnly,
}: {
  profiles: WiringProfileItem[]
  selected: string | null
  onSelect: (name: string) => void
  /** Make this profile the active one (the pod's default). */
  onMakeDefault?: (name: string) => void
  onDelete?: (name: string) => void
  /** Start a new profile with this name. */
  onCreate?: (name: string, from: NewProfileFrom) => void
  /** More entries for the ⋯ menu (Menu.Item elements). */
  menu?: ReactNode
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
  const create = (from: NewProfileFrom) => {
    onCreate?.(newName, from)
    setNewName('')
    setCreating(false)
  }
  const canDelete = !!(current && !current.isDefault && onDelete)

  return (
    <Stack gap={6}>
      <Group gap="xs" wrap="nowrap" align="center">
        <Select
          size="xs"
          aria-label="Wiring profile"
          style={{ flex: 1, minWidth: 120 }}
          data={profiles.map((p) => ({ value: p.name, label: p.isDefault ? `${p.name} (active)` : p.name }))}
          value={selected}
          onChange={(v) => v && onSelect(v)}
          disabled={busy || profiles.length === 0}
          placeholder={profiles.length ? 'Pick a profile' : 'No profiles on the pod yet'}
          allowDeselect={false}
        />
        {current?.isDefault ? (
          <Tooltip label="Powering the board on uses this profile, and so does every tool that names no profile" withArrow multiline w={240}>
            <Badge size="sm" color="green" variant="light">
              Active
            </Badge>
          </Tooltip>
        ) : current && onMakeDefault ? (
          <Tooltip label="Use this profile when the board powers on, and in every tool that names no profile" withArrow multiline w={240}>
            <Button size="compact-xs" variant="light" disabled={busy || readOnly} onClick={() => onMakeDefault(current.name)}>
              Make active
            </Button>
          </Tooltip>
        ) : null}
        {onCreate ? (
          <Button
            size="compact-xs"
            variant="default"
            disabled={busy || readOnly || profiles.length >= MAX_WIRING_PROFILES}
            onClick={() => setCreating((c) => !c)}
          >
            New
          </Button>
        ) : null}
        {menu || (current && onDelete) ? (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="More profile actions">
                ⋯
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {menu}
              {current && onDelete ? (
                <>
                  {menu ? <Menu.Divider /> : null}
                  <Menu.Item
                    color="red"
                    disabled={busy || readOnly || !canDelete}
                    onClick={() => onDelete(current.name)}
                    data-testid="delete-profile"
                  >
                    Delete {current.name}
                  </Menu.Item>
                  {current.isDefault ? (
                    <Text size="xs" c="dimmed" px="sm" pb={6} maw={220}>
                      The active profile can&apos;t be deleted: make another one active first.
                    </Text>
                  ) : null}
                </>
              ) : null}
            </Menu.Dropdown>
          </Menu>
        ) : null}
      </Group>
      {creating && onCreate ? (
        <Group gap="xs" align="flex-start" wrap="wrap">
          <TextInput
            size="xs"
            style={{ flex: 1, minWidth: 140 }}
            placeholder="nrf52840-dk"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value.trim().toLowerCase())}
            error={nameError}
            aria-label="New profile name"
            data-autofocus
          />
          <Button size="xs" disabled={!newName || !!nameError || busy} onClick={() => create('copy')}>
            {current ? `Copy of ${current.name}` : 'Create'}
          </Button>
          {current ? (
            <Button size="xs" variant="default" disabled={!newName || !!nameError || busy} onClick={() => create('empty')}>
              Empty
            </Button>
          ) : null}
          <Button size="xs" variant="subtle" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </Group>
      ) : null}
      {readOnly ? (
        <Text size="xs" c="dimmed">
          Offline: the last copy, read-only until the pod connects.
        </Text>
      ) : null}
    </Stack>
  )
}
