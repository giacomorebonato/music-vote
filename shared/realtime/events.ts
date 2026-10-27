/**
 * Server -> client WebSocket events for a music-vote room.
 *
 * Audience channel receives poll lifecycle + room lifecycle.
 * Host channel receives code updates, live vote counts, warnings, and
 * rejection notices.
 */

/** @public */
export type PollOpenedEvent = {
	type: 'poll_opened'
	poll: {
		id: string
		question: string
		options: string[]
		closesAt: string
	}
}

/** @public */
export type PollClosedEvent = {
	type: 'poll_closed'
	pollId: string
	winningOption: string | null
}

/** @public */
export type RoomEndedEvent = {
	type: 'room_ended'
}

type MusicResultEvent = {
	type: 'music_result'
	pollId: string
}

/** @public */
export type CodeUpdateEvent = {
	type: 'code_update'
	code: string
	versionId: string
	kind: 'initial' | 'evolution' | 'undo' | 'outro'
	phraseAligned?: boolean
}

/** @public */
export type VoteCountEvent = {
	type: 'vote_count'
	pollId: string
	counts: Record<string, number>
}

/** @public */
export type RoomStatusEvent = {
	type: 'room_status'
	status: string
}

/** @public */
export type WarningEvent = {
	type: 'warning'
	message: string
}

/** @public */
export type PatternRejectedEvent = {
	type: 'pattern_rejected'
	versionId: string
	error: string
}

/** @public */
export type WsEvent =
	| { type: 'crowd_changed' }
	| PollOpenedEvent
	| PollClosedEvent
	| RoomEndedEvent
	| MusicResultEvent
	| CodeUpdateEvent
	| VoteCountEvent
	| RoomStatusEvent
	| WarningEvent
	| PatternRejectedEvent
