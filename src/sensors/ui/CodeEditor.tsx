import { forwardRef, useImperativeHandle, useRef, type UIEvent } from 'react'
import { Box, useComputedColorScheme } from '@mantine/core'

export type CodeEditorHandle = { goToLine: (line: number) => void }

type Props = {
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
  /** 1-based line to mark (the validation error). */
  errorLine?: number | null
  minRows?: number
  ariaLabel?: string
}

const LINE_H = 19

/** A plain-text editor for YAML and JSON: monospace, line numbers, the error's line marked. */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, onChange, readOnly, errorLine, minRows = 24, ariaLabel = 'Definition source' },
  ref,
) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const dark = useComputedColorScheme('light') === 'dark'
  const lines = value.split('\n').length
  const rows = Math.max(minRows, Math.min(lines + 1, 48))

  useImperativeHandle(ref, () => ({
    goToLine(line: number) {
      const el = ta.current
      if (!el) return
      const parts = value.split('\n')
      const start = parts.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
      el.focus()
      el.setSelectionRange(start, start + (parts[line - 1]?.length ?? 0))
      el.scrollTop = Math.max(0, (line - 4) * LINE_H)
    },
  }))

  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop
  }

  const font = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  const border = dark ? '#373a40' : '#dee2e6'
  return (
    <Box style={{ display: 'flex', border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: dark ? '#1a1b1e' : '#fff' }}>
      <div
        ref={gutter}
        aria-hidden
        style={{
          overflow: 'hidden',
          padding: '8px 0',
          minWidth: 40,
          textAlign: 'right',
          fontFamily: font,
          fontSize: 13,
          lineHeight: `${LINE_H}px`,
          color: dark ? '#5c5f66' : '#adb5bd',
          background: dark ? '#141517' : '#f8f9fa',
          borderRight: `1px solid ${border}`,
          userSelect: 'none',
          height: rows * LINE_H + 16,
        }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            data-error-line={errorLine === i + 1 ? true : undefined}
            style={{
              paddingRight: 8,
              paddingLeft: 6,
              color: errorLine === i + 1 ? '#fff' : undefined,
              background: errorLine === i + 1 ? '#e03131' : undefined,
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={ta}
        aria-label={ariaLabel}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        onScroll={onScroll}
        onChange={(e) => onChange?.(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Tab inserts two spaces (YAML has no tabs).
          if (e.key !== 'Tab' || readOnly || e.shiftKey) return
          e.preventDefault()
          const el = e.currentTarget
          const s = el.selectionStart
          const next = value.slice(0, s) + '  ' + value.slice(el.selectionEnd)
          onChange?.(next)
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
        }}
        style={{
          flex: 1,
          border: 0,
          outline: 'none',
          resize: 'none',
          padding: '8px 10px',
          fontFamily: font,
          fontSize: 13,
          lineHeight: `${LINE_H}px`,
          height: rows * LINE_H + 16,
          background: 'transparent',
          color: 'inherit',
          whiteSpace: 'pre',
          overflow: 'auto',
          tabSize: 2,
        }}
      />
    </Box>
  )
})
