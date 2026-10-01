import { expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { bootSchedulers } from '@backend/boot'

test('bootSchedulers awaits the injected restore exactly once', async () => {
	let calls = 0
	await bootSchedulers(async () => {
		calls += 1
	})
	expect(calls).toBe(1)
})

test('a failing restore is logged, not thrown (server still boots)', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => {})
	const failure = new Error('db unavailable')

	try {
		await expect(
			bootSchedulers(async () => {
				throw failure
			}),
		).resolves.toBeUndefined()
		expect(logged).toHaveBeenCalledTimes(1)
		expect(logged.mock.calls[0]?.[1]).toBe(failure)
	} finally {
		logged.mockRestore()
	}
})

/**
 * Wiring guard — not a behavior test.
 *
 * `restoreSchedulers` existed, was unit-tested, and was never called from the
 * production entrypoint, so the spec's failure-table promise ("server restart
 * rebuilds timers from DB", docs/agents/music-vote.md) was silently broken:
 * after a mid-set restart, live rooms were orphaned. A unit test on
 * `bootSchedulers` cannot catch that — it passes whether or not anything calls
 * the seam. This asserts the file `bun run dev` / `bun run start` actually
 * execute (`backend/server.ts`) imports and awaits it.
 */
test('server.ts wires the boot restore seam (wiring guard)', () => {
	const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8')
	const withoutImports = source
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('import'))
		.join('\n')

	expect(source).toMatch(/from '@backend\/boot'/)
	expect(withoutImports).toMatch(/await bootSchedulers\(\)/)
})
