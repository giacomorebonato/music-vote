/**
 * One browser-only Strudel engine owns audio for the host. Playback observers
 * share its scheduler with visualizations. Prepared actions wait for a four-bar
 * phrase; a generation token cancels a waiting action after Undo or stop.
 *
 * evaluate catches its own errors, so applyPattern checks the returned pattern
 * and the onEvalError callback. AudioContext state is reported separately to
 * allow keyboard and pointer activation after a reload.
 *
 * The dirt-samples mapping loads once, then the complete demo palette (index 0)
 * is warmed. Download failures remain visible through prepareDemoAudio and can
 * be retried. Synthesized bass, chords and hooks need no sample downloads.
 */
import { demoDrums } from '@shared/schemas/music'

import {
	evaluate,
	getAudioContext,
	getSampleInfo,
	getSound,
	hush,
	initStrudel,
	loadBuffer,
	samples,
	type ReplState,
	type Scheduler,
} from '@strudel/web'

export type ApplyResult =
	{ ok: true; audioRunning: boolean } | { ok: false; error: string }

let initPromise: Promise<unknown> | null = null
let lastEvalError: Error | null = null
let scheduler: Scheduler | null = null
let playbackState: ReplState | null = null
const playbackListeners = new Set<
	(state: ReplState, clock: Scheduler) => void
>()

function publishPlayback(): void {
	if (!playbackState || !scheduler) return
	for (const listener of playbackListeners) {
		try {
			listener(playbackState, scheduler)
		} catch (err) {
			// A visual failure must not turn a successful music update into a failure.
			console.error('Strudel visual update failed', err)
		}
	}
}

export function subscribePlayback(
	listener: (state: ReplState, clock: Scheduler) => void,
): () => void {
	playbackListeners.add(listener)
	if (playbackState && scheduler) listener(playbackState, scheduler)
	return () => {
		playbackListeners.delete(listener)
	}
}

const onEvalError = (err: Error): void => {
	lastEvalError = err
}

const getLastEvalErrorMessage = (): string | undefined => {
	return lastEvalError?.message
}

export function initStrudelOnce(): Promise<unknown> {
	if (initPromise) return initPromise

	const promise = initStrudel({
		onEvalError,
		onUpdateState: (state: ReplState) => {
			playbackState = { ...state }
			publishPlayback()
		},
		prebake: async () => {
			try {
				await samples('github:tidalcycles/dirt-samples')
				soundFailures = await warmDemoDrums()
			} catch (err) {
				// Preload failure is not fatal: the engine is ready, and a missing
				// sample bank will surface as an error when a pattern tries to use it.
				soundFailures = [
					err instanceof Error ? err.message : 'Could not load sound bank',
				]
			}
		},
	})

	initPromise = promise
		.then((repl) => {
			scheduler = repl.scheduler
			playbackState = { ...repl.state }
			publishPlayback()
			return repl
		})
		.catch((err) => {
			initPromise = null
			throw err
		})
	return initPromise
}

let soundFailures: string[] = []

export async function prepareDemoAudio(): Promise<string[]> {
	await initStrudelOnce()
	if (soundFailures.length) {
		await samples('github:tidalcycles/dirt-samples')
		soundFailures = await warmDemoDrums()
	}
	return soundFailures
}

async function warmDemoDrums(): Promise<string[]> {
	const ac = getAudioContext()
	if (!ac) return ['Audio is unavailable']
	const failures: string[] = []
	for (const name of demoDrums) {
		try {
			const source = getSound(name)
			if (!source || !source.data?.samples) {
				failures.push(name)
				continue
			}
			const bank = source.data.samples
			const info = getSampleInfo({ s: name, n: 0 }, bank)
			const url = source.data._base
				? `${source.data._base}${info.url}`
				: info.url
			await loadBuffer(url, ac, info.label)
		} catch {
			failures.push(name)
		}
	}
	return failures
}

/** Wait using the playing musical clock, including scheduler lookahead. */
export async function waitForPhrase(
	cancelled: () => boolean,
): Promise<boolean> {
	if (
		!scheduler ||
		!playbackState?.started ||
		getAudioContext()?.state !== 'running'
	)
		return !cancelled()
	const deadline = Date.now() + 30_000
	const boundary = Math.ceil((scheduler.now() + 0.15) / 4) * 4
	while (scheduler.now() < boundary - 0.06) {
		if (
			cancelled() ||
			Date.now() > deadline ||
			!playbackState?.started ||
			getAudioContext()?.state !== 'running'
		)
			return false
		await new Promise((resolve) => setTimeout(resolve, 20))
	}
	return !cancelled()
}

/**
 * Try to start the audio clock without a user gesture.
 *
 * A reloaded host document has no user activation, so browsers that enforce
 * their autoplay policy keep the AudioContext suspended even though the
 * pattern is already scheduled (Strudel only unlocks on a one-time document
 * `mousedown`). `resume()` succeeds where the browser permits it (prior
 * engagement with the origin, autoplay allowed) and is otherwise a no-op —
 * callers learn the concrete state from the returned boolean.
 */
export async function resumeAudio(): Promise<boolean> {
	const ac = getAudioContext() as AudioContext | null
	if (!ac) return false
	if (ac.state === 'running') return true
	try {
		await ac.resume()
	} catch {
		// Chrome rejects the promise without a gesture; re-check anyway in case
		// the state flipped asynchronously.
	}
	// `resume()` can flip the state asynchronously, but TS keeps the
	// post-early-return narrowing — widen before re-checking.
	const state = ac.state as AudioContext['state']
	return state === 'running'
}

export async function applyPattern(
	code: string,
	autoplay = true,
): Promise<ApplyResult> {
	lastEvalError = null
	try {
		await initStrudelOnce()
		const pattern = await evaluate(code, autoplay)
		if (!pattern) {
			return {
				ok: false,
				error: getLastEvalErrorMessage() ?? 'evaluation failed',
			}
		}
		// Re-evaluated patterns keep the old loop playing until swapped; a
		// suspended clock (fresh reload, no gesture yet) does not tick, so the
		// caller needs to know and can put a single obvious unlock in front of it.
		const audioRunning = autoplay ? await resumeAudio() : true
		return { ok: true, audioRunning }
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err)
		return { ok: false, error }
	}
}

export function stopStrudel(): void {
	hush()
}
