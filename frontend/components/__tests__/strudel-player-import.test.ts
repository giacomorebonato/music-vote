import { expect, mock, test } from 'bun:test'

/**
 * Import guard for the StrudelPlayer component under Bun's test runner.
 *
 * Without a `@strudel/web` mock, importing the component walks into the
 * package's CJS `main` entry, which Bun's Node runtime cannot load (the
 * browser bundler picks the ESM `module` entry instead). `mock.module` must
 * be registered before the dynamic import so the seam module never resolves
 * the real package.
 *
 * The ref contract itself (applyPattern/stop exposure, null-code guard,
 * re-render stability, unmount hush) needs a DOM renderer this repo does not
 * have; it is verified manually in the host console. See
 * `.superpowers/sdd/2026-10-01-music-vote/task-12-report.md`.
 */
mock.module('@strudel/web', () => ({
	initStrudel: mock(() => Promise.resolve()),
	hush: mock(() => undefined),
	evaluate: mock(() => Promise.resolve({ __pattern: true })),
	samples: mock(() => Promise.resolve()),
	loadBuffer: mock(() => Promise.resolve()),
	getAudioContext: mock(() => null),
	getSound: mock(() => null),
	getSampleInfo: mock(() => ({ url: 'x', label: 'x' })),
}))

const playerModule = await import('@frontend/audio/strudel-player')

test('StrudelPlayer module imports with @strudel/web mocked', () => {
	expect(playerModule.StrudelPlayer).toBeDefined()
	expect(playerModule.StrudelPlayer.displayName).toBe('StrudelPlayer')
})
