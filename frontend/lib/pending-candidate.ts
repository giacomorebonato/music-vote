import type { CodeUpdateEvent } from '@shared/realtime/events'

/** A `rooms.get` version row, trimmed to what replay needs. */
type VersionRow = {
	id: string
	code: string
	source: string
	status: string
}

/**
 * Find the pattern version the host never got to apply.
 *
 * Evolution and outro versions are published to the host exactly once as a
 * `code_update` frame; the room's `currentCode` only advances once the host
 * confirms the apply. When the host page misses that frame (reload, HMR
 * reconnect, dropped socket), the version stays `candidate` forever and the
 * set silently stops evolving — this turns the newest pending candidate back
 * into a `code_update` event the host can apply and confirm.
 *
 * `versions` arrives newest-first from `rooms.get`; `initial` versions are
 * created already-applied and never need replay.
 */
export function pickPendingCandidate(
	versions: VersionRow[],
	roomStatus: string | null | undefined,
): CodeUpdateEvent | null {
	if (roomStatus !== 'live' && roomStatus !== 'outro') return null
	const pending = versions.find(
		(version) => version.status === 'candidate' && version.source !== 'initial',
	)
	if (!pending) return null
	return {
		type: 'code_update',
		code: pending.code,
		versionId: pending.id,
		kind: pending.source === 'outro' ? 'outro' : 'evolution',
		...(pending.code.startsWith('// music-vote performance\n')
			? { phraseAligned: true }
			: {}),
	}
}
