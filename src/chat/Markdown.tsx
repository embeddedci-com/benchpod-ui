import { Fragment, type ReactNode } from 'react'
import { Code, Table, Text, Title } from '@mantine/core'

// A small Markdown renderer for the agent's replies: headings, paragraphs, lists, fenced code,
// pipe tables, **bold**, *italic* and `code`. No raw HTML and no links, on purpose: a reply is
// model output, which a visitor (or a log the model read) may have steered, so nothing in it
// becomes markup or a place to click. No dependency either, so the hosts that link this source
// install nothing extra.

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join(' ') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*```\s*([\w+-]*)/)
    if (fence) {
      flush()
      const body: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i])
      out.push({ t: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flush()
      out.push({ t: 'h', level: h[1].length, text: h[2] })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]))
      i--
      out.push({ t: 'table', head, rows })
      continue
    }
    const li = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/)
    if (li) {
      flush()
      const kind = /\d/.test(li[1]) ? 'ol' : 'ul'
      const last = out[out.length - 1]
      if (last && last.t === kind) last.items.push(li[2])
      else out.push({ t: kind, items: [li[2]] })
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    // A continuation line of a list item.
    const last = out[out.length - 1]
    if (para.length === 0 && last && (last.t === 'ul' || last.t === 'ol') && /^\s{2,}/.test(line)) {
      last.items[last.items.length - 1] += ' ' + line.trim()
      continue
    }
    para.push(line.trim())
  }
  flush()
  return out
}

/** Inline spans: `code`, **bold**, *italic*. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const s = m[0]
    if (s.startsWith('`')) out.push(<Code key={k++}>{s.slice(1, -1)}</Code>)
    else if (s.startsWith('**')) out.push(<strong key={k++}>{s.slice(2, -2)}</strong>)
    else out.push(<em key={k++}>{s.slice(1, -1)}</em>)
    last = m.index + s.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseBlocks(text).map((b, i) => {
        switch (b.t) {
          case 'h':
            return (
              <Title key={i} order={Math.min(6, b.level + 2) as 3 | 4 | 5 | 6} mt="xs" mb={4}>
                {inline(b.text)}
              </Title>
            )
          case 'p':
            return (
              <Text key={i} size="sm" mb={6} style={{ whiteSpace: 'pre-wrap' }}>
                {inline(b.text)}
              </Text>
            )
          case 'ul':
          case 'ol': {
            const L = b.t
            return (
              <L key={i} style={{ margin: '0 0 6px', paddingLeft: 20, fontSize: 'var(--mantine-font-size-sm)' }}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </L>
            )
          }
          case 'code':
            return (
              <Code key={i} block mb={6} style={{ fontSize: 12, maxHeight: 360, overflow: 'auto' }}>
                {b.text}
              </Code>
            )
          case 'table':
            return (
              <Table.ScrollContainer key={i} minWidth={300} mb={6}>
                <Table withTableBorder withColumnBorders fz="xs" striped>
                  <Table.Thead>
                    <Table.Tr>
                      {b.head.map((c, j) => (
                        <Table.Th key={j}>{inline(c)}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {b.rows.map((r, j) => (
                      <Table.Tr key={j}>
                        {r.map((c, n) => (
                          <Table.Td key={n}>{inline(c)}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )
        }
        return <Fragment key={i} />
      })}
    </>
  )
}
