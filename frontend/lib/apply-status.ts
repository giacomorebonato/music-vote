export type ApplyStatus = {
	text: string
	tone: 'success' | 'error' | 'warning'
}

/**
 * Host-console "apply status" badge state.
 *
 * The badge has two writers — the `code_update` frame handler and the undo
 * mutation — and their completions are asynchronous, so which one lands last is
 * not fixed: a Strudel `evaluate` from an earlier apply can resolve *after* the
 * undo response, and the undo's own frame can arrive before or after it. Pure
 * last-writer-wins would then show `change applied` for a set the host just
 * reverted.
 *
 * The badge is therefore the outcome of the newest operation. Every operation
 * claims a monotonic `seq` when it STARTS (an apply frame, or the Undo click),
 * and a fact is applied only while no newer operation has been claimed. The
 * claimed `seq` lives in the state, so the claim alone rejects the older
 * operation's in-flight result — no dependence on render timing.
 */
export type ApplyStatusState = {
	status: ApplyStatus | null
	seq: number
}

export const initialApplyStatusState: ApplyStatusState = {
	status: null,
	seq: 0,
}

export type ApplyStatusFact =
	/** An operation claimed `seq`. Leaves the badge alone, invalidates older writes. */
	| { type: 'start'; seq: number }
	/** An apply finished and the audio engine accepted the code. */
	| { type: 'applied'; seq: number }
	/** The host reverted the last change (undo response or the undo frame). */
	| { type: 'reverted'; seq: number }
	/** An apply (or the host's report of it) was rejected. */
	| { type: 'failed'; seq: number; error: string }

export function reduceApplyStatus(
	state: ApplyStatusState,
	fact: ApplyStatusFact,
): ApplyStatusState {
	if (fact.type === 'start') {
		return { status: state.status, seq: Math.max(state.seq, fact.seq) }
	}
	if (fact.seq < state.seq) return state

	switch (fact.type) {
		case 'applied':
			return {
				status: { text: 'change applied', tone: 'success' },
				seq: state.seq,
			}
		case 'reverted':
			return {
				status: { text: 'reverted', tone: 'warning' },
				seq: state.seq,
			}
		case 'failed':
			return {
				status: { text: `change rejected: ${fact.error}`, tone: 'error' },
				seq: state.seq,
			}
	}
}
