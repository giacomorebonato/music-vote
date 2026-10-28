import { expect, test } from 'bun:test'
import { pickPendingCandidate } from '@frontend/lib/pending-candidate'

/**
 * A `candidate` version is published to the host exactly once over WS. When
 * the host page is not connected at that instant (reload, HMR reconnect,
 * dropped socket), the frame is lost — and without a replay the evolution
 * silently never applies: `currentCode` only advances on host confirmation.
 * The host therefore reconciles the newest pending candidate from the
 * `rooms.get` payload (its `versions` rows, newest first) on every fetch.
 */

type VersionRow = Parameters<typeof pickPendingCandidate>[0][number]

function row(overrides: Partial<VersionRow> = {}): VersionRow {
	return {
		id: 'version-1',
		code: 's("bd sd")',
		source: 'poll-1',
		status: 'candidate',
		...overrides,
	}
}

test('returns the newest candidate as an evolution code_update for a live room', () => {
	const event = pickPendingCandidate(
		[
			row({ id: 'applied', status: 'applied', source: 'poll-0' }),
			row({ id: 'newest', source: 'poll-2' }),
			row({ id: 'older', source: 'poll-1' }),
		],
		'live',
	)
	expect(event).toEqual({
		type: 'code_update',
		code: 's("bd sd")',
		versionId: 'newest',
		kind: 'evolution',
		phraseAligned: true,
	})
})

test('maps an outro-source candidate to the outro kind', () => {
	const event = pickPendingCandidate(
		[row({ id: 'outro-1', source: 'outro' })],
		'outro',
	)
	expect(event).toMatchObject({ versionId: 'outro-1', kind: 'outro' })
})

test('ignores candidates when the room is not playing anymore', () => {
	expect(pickPendingCandidate([row()], 'ended')).toBeNull()
	expect(pickPendingCandidate([row()], 'lobby')).toBeNull()
	expect(pickPendingCandidate([row()], null)).toBeNull()
	expect(pickPendingCandidate([row()], undefined)).toBeNull()
})

test('skips initial versions and non-candidate statuses', () => {
	expect(
		pickPendingCandidate([row({ id: 'init', source: 'initial' })], 'live'),
	).toBeNull()
	expect(
		pickPendingCandidate([row({ id: 'r', status: 'rejected' })], 'live'),
	).toBeNull()
	expect(
		pickPendingCandidate([row({ id: 'v', status: 'reverted' })], 'live'),
	).toBeNull()
	expect(
		pickPendingCandidate([row({ id: 'a', status: 'applied' })], 'live'),
	).toBeNull()
})

test('returns null with no versions at all', () => {
	expect(pickPendingCandidate([], 'live')).toBeNull()
})

test('reconnecting performance candidates retain phrase scheduling', () => {
	expect(
		pickPendingCandidate(
			[
				row({
					code: '// music-vote performance\nall(x => x.lpf(500))\ns("bd")',
				}),
			],
			'live',
		)?.phraseAligned,
	).toBe(true)
})
