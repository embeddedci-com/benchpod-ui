import { benchData, type BenchCall } from '../../bench/benchCall'
import { stepDiff, type SequenceStep } from './model'

// Runs a saved sequence through the host's BenchCall, one step after the other, so every step
// gets the same confirmations (and the same log rows) as a call made by hand.

export type StepOutcome = {
  /** ok: ran and matched; differs: ran, but a read saw something else; skipped: not reached. */
  status: 'ok' | 'differs' | 'error' | 'declined' | 'skipped'
  note?: string
}

/**
 * Run the steps in order. A failed or declined step stops the run (the rest are skipped), the way
 * a pytest test stops at the first error; a read that differs from the recording does not.
 */
export async function runSequence(
  call: BenchCall,
  steps: SequenceStep[],
  onStep?: (index: number, outcome: StepOutcome) => void,
  signal?: AbortSignal,
): Promise<StepOutcome[]> {
  const out: StepOutcome[] = steps.map(() => ({ status: 'skipped' }))
  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) break
    const r = await call(steps[i].tool, steps[i].args, { signal })
    let o: StepOutcome
    if (r.declined) o = { status: 'declined', note: r.text || 'not run' }
    else if (r.is_error || r.refused || r.confirm) o = { status: 'error', note: r.text || 'the call failed' }
    else {
      const diff = stepDiff(steps[i], benchData(r))
      o = diff ? { status: 'differs', note: diff } : { status: 'ok' }
    }
    out[i] = o
    onStep?.(i, o)
    if (o.status === 'error' || o.status === 'declined') break
  }
  return out
}
