import { restoreSchedulers } from '@backend/polls/scheduler'

/** Restore crowd checks, set deadlines, and outro timers after a restart.
 * A failure is logged so the HTTP server can continue serving the venue.
 */
export async function bootSchedulers(
	restore: () => Promise<void> = restoreSchedulers,
): Promise<void> {
	try {
		await restore()
	} catch (error) {
		console.error(
			'boot: scheduler restore failed; continuing without restored timers',
			error,
		)
	}
}
