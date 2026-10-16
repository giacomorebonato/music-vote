import { restoreSchedulers } from '@backend/polls/scheduler'

/**
 * Boot-time scheduler restore.
 *
 * `restoreSchedulers` rebuilds poll and outro timers from the DB for rooms that
 * were mid-set when the process stopped. Without it a restart mid-set orphans
 * every live room: no poll opens or closes, no end timer fires, and votes land
 * in the DB without any effect — the spec's failure table ("server restart →
 * PollScheduler rebuilds timers from DB") would be a promise the shipped server
 * never keeps.
 *
 * The restore function is injected so the failure path is testable. A restore
 * failure is logged, never thrown: the HTTP server is already listening, and
 * crashing would take the whole venue down instead of leaving a usable app
 * whose timers were not restored.
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
