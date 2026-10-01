import { expect, test } from 'bun:test'
import {
	type ApplyStatusState,
	initialApplyStatusState,
	reduceApplyStatus,
} from '@frontend/lib/apply-status'

/**
 * The badge has two asynchronous writers (the `code_update` frame handler and
 * the undo mutation). These tests fix the invariant the host console needs:
 * once the host undoes a change, the badge reads `reverted` whichever writer
 * completes first.
 */

const APPLIED = { text: 'change applied', tone: 'success' } as const
const REVERTED = { text: 'reverted', tone: 'warning' } as const

test('undo response first: a late apply result for the superseded version is ignored', () => {
	const start: ApplyStatusState = reduceApplyStatus(initialApplyStatusState, {
		type: 'start',
		seq: 1,
	})
	// Undo is clicked while the apply above is still running in Strudel.
	const undoStarted: ApplyStatusState = reduceApplyStatus(start, {
		type: 'start',
		seq: 2,
	})
	const undone: ApplyStatusState = reduceApplyStatus(undoStarted, {
		type: 'reverted',
		seq: 2,
	})
	expect(undone.status).toEqual(REVERTED)

	// The earlier apply's `evaluate` resolves only now.
	const late: ApplyStatusState = reduceApplyStatus(undone, {
		type: 'applied',
		seq: 1,
	})
	expect(late.status).toEqual(REVERTED)
})

test('WS apply first: the undo response still wins and stays reverted', () => {
	let state: ApplyStatusState = reduceApplyStatus(initialApplyStatusState, {
		type: 'start',
		seq: 1,
	})
	state = reduceApplyStatus(state, { type: 'applied', seq: 1 })
	expect(state.status).toEqual(APPLIED)

	state = reduceApplyStatus(state, { type: 'start', seq: 2 })
	state = reduceApplyStatus(state, { type: 'reverted', seq: 2 })
	expect(state.status).toEqual(REVERTED)

	// The undo's own `code_update` frame lands after the mutation response and
	// reuses the undo's token: same outcome, so it cannot flip the badge.
	state = reduceApplyStatus(state, { type: 'reverted', seq: 2 })
	expect(state.status).toEqual(REVERTED)
})

test('a later apply after an undo still updates the badge', () => {
	let state: ApplyStatusState = reduceApplyStatus(initialApplyStatusState, {
		type: 'start',
		seq: 1,
	})
	state = reduceApplyStatus(state, { type: 'reverted', seq: 1 })
	expect(state.status).toEqual(REVERTED)

	// Next poll's evolution, or the outro.
	state = reduceApplyStatus(state, { type: 'start', seq: 2 })
	state = reduceApplyStatus(state, { type: 'applied', seq: 2 })
	expect(state.status).toEqual(APPLIED)
})

test('a rejected apply reports the error and outranks an older apply', () => {
	let state: ApplyStatusState = reduceApplyStatus(initialApplyStatusState, {
		type: 'start',
		seq: 1,
	})
	state = reduceApplyStatus(state, { type: 'applied', seq: 1 })
	state = reduceApplyStatus(state, { type: 'start', seq: 2 })
	state = reduceApplyStatus(state, { type: 'failed', seq: 2, error: 'boom' })
	expect(state.status).toEqual({ text: 'change rejected: boom', tone: 'error' })

	// A late success from the superseded apply cannot clear the error.
	state = reduceApplyStatus(state, { type: 'applied', seq: 1 })
	expect(state.status).toEqual({ text: 'change rejected: boom', tone: 'error' })
})
