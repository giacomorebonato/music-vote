import { expect, test } from 'bun:test'
import {
	MARKER,
	activePerformanceAction,
	performancePattern,
} from '../performance'

const base = 'setcps(0.5)\nstack(s("bd*4"), note("c2 eb2 g2").s("sawtooth"))'

test('the marker stays byte-identical for existing versions and prompts', () => {
	expect(MARKER).toBe('// music-vote performance\n')
})

test('each layer wraps the base and strips cleanly', () => {
	for (const action of ['build', 'drop', 'strip'] as const) {
		const code = performancePattern(base, action)
		expect(code.startsWith(MARKER)).toBe(true)
		expect(code.endsWith(base)).toBe(true)
		expect(performancePattern(code, 'clear')).toBe(base)
	}
})

test('a new layer replaces the previous one instead of stacking', () => {
	const built = performancePattern(base, 'build')
	expect(performancePattern(built, 'drop')).toBe(
		performancePattern(base, 'drop'),
	)
})

test('clear is idempotent on plain code', () => {
	expect(performancePattern(base, 'clear')).toBe(base)
	expect(performancePattern(performancePattern(base, 'clear'), 'clear')).toBe(
		base,
	)
})

test('activePerformanceAction reads the layer from the playing code', () => {
	for (const action of ['build', 'drop', 'strip'] as const) {
		expect(activePerformanceAction(performancePattern(base, action))).toBe(
			action,
		)
	}
	expect(activePerformanceAction(base)).toBeNull()
	// An LLM-kept comment with an unrecognized transform must not light a toggle.
	expect(
		activePerformanceAction(`${MARKER}all(x => x.hpf(9999))\n${base}`),
	).toBeNull()
})
