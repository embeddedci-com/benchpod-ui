import type { BusSequence, SequenceInput, SequenceStore } from './model'

// The desktop's sequences: the local file always, plus the embeddedci.com account's when signed
// in. A new sequence goes to the local file, or to the account when it is shared; sharing a local
// one moves it to the account. Ids carry where a sequence lives ("local:" or "account:").

const LOCAL = 'local:'
const ACCOUNT = 'account:'

const tag = (prefix: string, s: BusSequence): BusSequence => ({ ...s, id: prefix + s.id })

export function combinedSequenceStore(local: SequenceStore, account: SequenceStore | null): SequenceStore {
  const where = (id: string): [SequenceStore, string, string] => {
    if (id.startsWith(ACCOUNT) && account) return [account, id.slice(ACCOUNT.length), ACCOUNT]
    return [local, id.startsWith(LOCAL) ? id.slice(LOCAL.length) : id, LOCAL]
  }
  return {
    canShare: !!account,
    where: account
      ? 'Saved on this computer; shared ones are kept in your embeddedci.com account.'
      : 'Saved on this computer. Sign in to embeddedci.com (an EmbeddedCI API key) to share one in your organization.',
    list: async () => {
      const [mine, theirs] = await Promise.all([local.list(), account ? account.list().catch(() => []) : Promise.resolve([])])
      return [...mine.map((s) => tag(LOCAL, { ...s, mine: true, shared: false })), ...theirs.map((s) => tag(ACCOUNT, s))]
    },
    create: async (s: SequenceInput) => (s.shared && account ? tag(ACCOUNT, await account.create(s)) : tag(LOCAL, await local.create({ ...s, shared: undefined }))),
    update: async (id, s) => {
      const [store, raw, prefix] = where(id)
      if (prefix === LOCAL && s.shared && account) {
        // Share a local sequence: it moves to the account.
        const cur = (await local.list()).find((x) => x.id === raw)
        if (!cur) throw new Error('no such sequence')
        const moved = await account.create({ name: s.name ?? cur.name, steps: s.steps ?? cur.steps, version: s.version ?? cur.version, shared: true })
        await local.remove(raw)
        return tag(ACCOUNT, moved)
      }
      const { shared, ...rest } = s
      return tag(prefix, await store.update(raw, prefix === ACCOUNT ? s : rest))
    },
    remove: async (id) => {
      const [store, raw] = where(id)
      await store.remove(raw)
    },
  }
}
