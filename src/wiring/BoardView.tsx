import { useMemo, useState } from 'react'
import { Button, Group, Modal, SegmentedControl, Stack, Table } from '@mantine/core'
import { BOARD_HEADER_LABELS, boardSheet, boardSheetHtml, boardSvg, sheetRows, type BoardHeader } from './boardSheet'
import type { Wiring } from './model'

// The wiring profile on the pod's real header, to look at, print or keep. Read-only: the Pins
// editor is where it changes. The drawing is boardSvg's string, so what is on screen is exactly
// what the download and the printout hold.

function fileName(title: string, ext: string) {
  return `${title.replace(/[^\w.-]+/g, '_') || 'wiring'}-pinout.${ext}`
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Print through a hidden frame holding only the sheet, so no app chrome ends up on paper. */
function printSheet(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    return
  }
  doc.open()
  doc.write(html)
  doc.close()
  const go = () => {
    win.focus()
    win.print()
    setTimeout(() => frame.remove(), 1000)
  }
  if (doc.readyState === 'complete') setTimeout(go, 50)
  else frame.onload = go
}

function readChoice(key: string | undefined): BoardHeader {
  try {
    const v = key ? localStorage.getItem(key) : null
    return v === 'front' ? 'front' : 'j1'
  } catch {
    return 'j1'
  }
}

export function BoardView({
  wiring,
  title,
  header: detected,
  storageKey,
}: {
  wiring: Wiring
  title: string
  /** The pod's header when its status says (boardHeaderFromStatus); null: the user picks. */
  header: BoardHeader | null
  /** Where the user's pick is remembered (per pod), when the pod does not say. */
  storageKey?: string
}) {
  const [picked, setPickedState] = useState<BoardHeader>(() => readChoice(storageKey))
  const setPicked = (h: BoardHeader) => {
    setPickedState(h)
    try {
      if (storageKey) localStorage.setItem(storageKey, h)
    } catch {
      /* private mode: the pick lasts for this view */
    }
  }
  const header = detected ?? picked
  const sheet = useMemo(() => boardSheet(wiring, header, title), [wiring, header, title])
  const svg = useMemo(() => boardSvg(sheet), [sheet])
  const rows = useMemo(() => sheetRows(sheet), [sheet])

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap" gap="xs">
        {detected ? (
          <span />
        ) : (
          <SegmentedControl
            size="xs"
            value={picked}
            onChange={(v) => setPicked(v as BoardHeader)}
            data={(['j1', 'front'] as BoardHeader[]).map((h) => ({ value: h, label: BOARD_HEADER_LABELS[h] }))}
            aria-label="Which header"
          />
        )}
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => download(fileName(title, 'svg'), svg, 'image/svg+xml')}>
            Download SVG
          </Button>
          <Button size="xs" onClick={() => printSheet(boardSheetHtml(sheet))}>
            Print
          </Button>
        </Group>
      </Group>
      <div
        data-testid="board-view-svg"
        style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--mantine-color-default-border)', background: '#fff' }}
        // The drawing is built from escaped profile text (boardSheet.ts esc()).
        dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg style="width:100%;height:auto;display:block" ') }}
      />
      <Table.ScrollContainer minWidth={520} type="native">
        <Table striped withTableBorder fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Header pin</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Used for</Table.Th>
              <Table.Th>Connect to</Table.Th>
              <Table.Th>Pull resistor</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={`${r.pins}-${r.name}`}>
                <Table.Td>{r.pins}</Table.Td>
                <Table.Td ff="monospace">{r.name}</Table.Td>
                <Table.Td>{r.usedFor}</Table.Td>
                <Table.Td>{r.connect}</Table.Td>
                <Table.Td>{r.pull}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  )
}

/** BoardView in a modal: what the hosts' "Visualize" buttons open. */
export function BoardViewModal({
  opened,
  onClose,
  wiring,
  title,
  header,
  storageKey,
}: {
  opened: boolean
  onClose: () => void
  wiring: Wiring
  title: string
  header: BoardHeader | null
  storageKey?: string
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={title === 'wiring' ? 'Wiring' : `Wiring: ${title}`} size="xl" centered>
      {opened ? <BoardView wiring={wiring} title={title} header={header} storageKey={storageKey} /> : null}
    </Modal>
  )
}
