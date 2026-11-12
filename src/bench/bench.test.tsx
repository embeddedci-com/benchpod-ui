// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { useEffect } from 'react'
import { benchData, benchError, useBenchCall, type BenchResult } from './benchCall'

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness({ onResult }: { onResult: (r: BenchResult) => void }) {
  const { call, dialog } = useBenchCall('/api/tool')
  useEffect(() => {
    void call('power_on', { efuse: 1 }).then(onResult)
  }, [call, onResult])
  return <MantineProvider>{dialog}</MantineProvider>
}

describe('useBenchCall', () => {
  it('asks before a risky call and sends it again with confirmed', async () => {
    const bodies: { confirmed: boolean }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string)
      bodies.push(b)
      return new Response(JSON.stringify(b.confirmed ? { text: '{"efuse":1,"on":true}', structured: { efuse: 1, on: true } } : { confirm: true }))
    }))
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(await screen.findByText('Run it'))
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(bodies.map((b) => b.confirmed)).toEqual([false, true])
    expect(benchData(onResult.mock.calls[0][0])).toEqual({ efuse: 1, on: true })
  })

  it('a no is a declined result, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ confirm: true }))))
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(await screen.findByText('Cancel'))
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    const r = onResult.mock.calls[0][0] as BenchResult
    expect(r.declined).toBe(true)
    expect(benchError(r)).toBeUndefined()
  })
})
