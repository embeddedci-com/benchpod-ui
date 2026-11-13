import { SEQUENCE_VERSION, type BusSequence, type SequenceInput, type SequenceStore } from './model'

// Sequences on embeddedci.com (GET/POST /benchpod/bus-sequences, PATCH/DELETE .../{id}):
// per user, shareable in the organization. The host gives the request function (base URL and
// sign-in are its business).

export type ApiRequest = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<Response>

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const b = (await r.json()) as { error?: string; message?: string }
      msg = b.error || b.message || msg
    } catch {
      /* not JSON */
    }
    throw new Error(msg)
  }
  return (await r.json()) as T
}

export function httpSequenceStore(request: ApiRequest, opts: { canShare?: boolean; where?: string } = {}): SequenceStore {
  const path = '/benchpod/bus-sequences'
  return {
    canShare: opts.canShare ?? true,
    where: opts.where ?? 'Saved to your embeddedci.com account.',
    list: async () => (await json<{ sequences: BusSequence[] }>(await request('GET', path))).sequences,
    create: async (s: SequenceInput) => json<BusSequence>(await request('POST', path, { version: SEQUENCE_VERSION, ...s })),
    update: async (id, s) => json<BusSequence>(await request('PATCH', `${path}/${encodeURIComponent(id)}`, s)),
    remove: async (id) => {
      const r = await request('DELETE', `${path}/${encodeURIComponent(id)}`)
      if (!r.ok && r.status !== 404) await json(r)
    },
  }
}
