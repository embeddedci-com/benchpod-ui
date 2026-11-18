import { ActionIcon, Anchor, HoverCard, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'

/** Where the docs live. The desktop app is not served from the site, so links are absolute. */
export const DOCS_ORIGIN = 'https://embeddedci.com'

/** A docs path (`/docs/...`) as a link that works in the web app and the desktop app alike. */
export function docsUrl(path: string): string {
  return /^https?:/.test(path) ? path : `${DOCS_ORIGIN}${path}`
}

/**
 * The UI's help: a small (i) next to a heading or a status line, with one or two sentences on
 * hover or tap and a "Read more" link into the docs. Explanations live here or in the docs, never as
 * paragraphs on the page. Not for inside an input's label: it would join the input's name.
 */
export function HelpTip({ label, children, docs }: { label: string; children: ReactNode; docs?: string }) {
  return (
    <HoverCard width={280} shadow="md" withArrow openDelay={150} closeDelay={250} position="top">
      <HoverCard.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          radius="xl"
          aria-label={`Help: ${label}`}
          onClick={(e) => e.stopPropagation()}
          style={{ verticalAlign: 'middle' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" strokeLinecap="round" />
            <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
          </svg>
        </ActionIcon>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={6}>
          <Text size="xs">{children}</Text>
          {docs ? (
            <Anchor href={docsUrl(docs)} target="_blank" rel="noopener" size="xs">
              Read more
            </Anchor>
          ) : null}
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  )
}
