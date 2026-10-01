/*
 * Strudel audio engine seam.
 *
 * Spike findings (Bun 1.4.2, @strudel/web pinned to 1.3.0 exact):
 *
 * - Bun's browser bundler resolves @strudel/web's `"module": "dist/index.mjs"`
 *   entry, so named ESM imports (initStrudel, hush, evaluate, samples, logger)
 *   work in the frontend bundle. Bun's Node runtime picks the CJS `main` and
 *   cannot resolve those names, so this module must stay browser-only.
 *
 * - Cycle-boundary swap is implicit. After initStrudel(), calling
 *   `evaluate(code)` runs `repl.evaluate -> setPattern(pattern)` on the
 *   Cyclist. The scheduler reads `this.pattern` only at the start of each
 *   clock tick, so a newly evaluated pattern takes effect at the next cycle
 *   boundary without any explicit scheduler call.
 *
 * - Sound bank: @strudel/web ships no offline samples. The default
 *   `dirt-samples` bank on GitHub is ~170 MB, so bundling it is not viable.
 *   We preload the bank mapping at init via
 *   `await samples('github:tidalcycles/dirt-samples')` (~46 KB JSON); the
 *   browser fetches individual sample files lazily when the pattern references
 *   them.
 */

import { evaluate, hush, initStrudel, samples } from '@strudel/web'

export type ApplyResult = { ok: true } | { ok: false; error: string }

let initPromise: Promise<unknown> | null = null

export function initStrudelOnce(): Promise<unknown> {
	if (initPromise) return initPromise

	const promise = initStrudel({
		prebake: async () => {
			try {
				await samples('github:tidalcycles/dirt-samples')
			} catch (err) {
				// Preload failure is not fatal: the engine is ready, and a missing
				// sample bank will surface as an error when a pattern tries to use it.
				void err
			}
		},
	})

	initPromise = promise
	return promise
}

export async function applyPattern(
	code: string,
	autoplay = true,
): Promise<ApplyResult> {
	try {
		await initStrudelOnce()
		await evaluate(code, autoplay)
		return { ok: true }
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err)
		return { ok: false, error }
	}
}

export function stopStrudel(): void {
	hush()
}
