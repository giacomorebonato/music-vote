/**
 * Strudel audio engine seam.
 *
 * Spike findings (Bun 1.4.2, @strudel/web pinned to 1.3.0 exact):
 *
 * - Bun's browser bundler resolves @strudel/web's `"module": "dist/index.mjs"`
 *   entry, so named ESM imports (`initStrudel`, `hush`, `evaluate`,
 *   `samples`, `loadBuffer`, `getAudioContext`, `getSound`, `getSampleInfo`)
 *   work in the frontend bundle. Bun's Node runtime resolves the CJS `main`
 *   and cannot load those names, so this module must stay browser-only.
 *
 * - Cycle-boundary swap is implicit. After `initStrudel()`, calling
 *   `evaluate(code)` runs `repl.evaluate -> setPattern(pattern)` on the
 *   Cyclist. The scheduler reads `this.pattern` only at the start of each
 *   clock tick, so a newly evaluated pattern takes effect at the next cycle
 *   boundary without any explicit scheduler call.
 *
 * - Error contract: the exported `evaluate` in @strudel/web 1.3.0 is the
 *   REPL's evaluate, which CATCHES evaluation errors internally, stores them
 *   in `repl.state.evalError`, and resolves to `undefined`. Therefore
 *   `applyPattern` cannot rely on `evaluate` rejecting. We pass `onEvalError`
 *   to `initStrudel` to capture the last error, then truthiness-check the
 *   returned pattern; a falsy result means the new pattern did not take and
 *   we report `{ ok: false, error: lastEvalError?.message ?? 'evaluation failed' }`.
 *
 * - Sound bank: @strudel/web ships no offline samples. The default
 *   `dirt-samples` bank on GitHub is ~170 MB, so bundling it is not viable.
 *   We preload the bank mapping at init via
 *   `await samples('github:tidalcycles/dirt-samples')` (~46 KB JSON); the
 *   browser fetches individual sample files lazily when the pattern references
 *   them.
 *
 * - Sample buffer warmup (Finding 3): lazy loading means a freshly-voted
 *   pattern referencing new samples can be silent on first play in a venue
 *   with poor wifi. `loadBuffer` exists and is exported, but there is no
 *   public API to discover which sample URLs a pattern will use without
 *   reimplementing Strudel's sample-map logic. We therefore warm a fixed core
 *   drum set (`bd`, `sd`, `cp`, `hh`) at init by preloading the first buffer
 *   for each registered sound. This reduces the risk for the most common
 *   drum sounds while avoiding fragile per-pattern string parsing. Patterns
 *   using sounds outside this set still lazy-load. If an individual preload
 *   fails we continue silently; the show can still start.
 *
 * - Residual hazards documented for Task 12:
 *   1. `initAudioOnFirstClick` listens for `mousedown` only; keyboard-only
 *      activation will not resume the AudioContext. The host page should
 *      ensure a click/touch interaction before expecting audio.
 *   2. Strudel is a single global engine; two mounted StrudelPlayers share
 *      the same scheduler. One unmount calling `hush()` will stop audio for
 *      both. Host page should keep exactly one player mounted at a time.
 */

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
				await warmCoreDrums()
			} catch (err) {
				// Preload failure is not fatal: the engine is ready, and a missing
				// sample bank will surface as an error when a pattern tries to use it.
				void err
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

async function warmCoreDrums(): Promise<void> {
	const ac = getAudioContext()
	if (!ac) return

	const coreSounds = ['bd', 'sd', 'cp', 'hh']
	for (const name of coreSounds) {
		try {
			const source = getSound(name)
			if (!source || !source.data?.samples) continue
			const bank = source.data.samples
			const info = getSampleInfo({ s: name, n: 0 }, bank)
			const url = source.data._base
				? `${source.data._base}${info.url}`
				: info.url
			await loadBuffer(url, ac, info.label)
		} catch {
			// Warmup is best-effort; do not block init if one sound is missing.
		}
	}
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
