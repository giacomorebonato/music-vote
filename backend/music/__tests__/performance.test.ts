import { expect, test } from 'bun:test'
import { performancePattern } from '@backend/music/performance'
import { buildInitialPatternPrompt } from '@backend/music/prompts'
import { compileCheck } from '@backend/music/validate'

const base = 'setcps(0.5)\nstack(s("bd*4"), note("c2 eb2 g2").s("sawtooth"))'
test('prepared actions compile and replace earlier performance layers without changing the base groove', () => {
	for (const action of ['build', 'drop', 'strip'] as const) {
		const code = performancePattern(base, action)
		expect(compileCheck(code)).toEqual({ ok: true })
		expect(code.endsWith(base)).toBe(true)
		const replacement = performancePattern(code, 'drop')
		expect(replacement).toBe(performancePattern(base, 'drop'))
	}
})
test('genre opening anchors are valid patterns with independent musical layers', () => {
	const prompt = buildInitialPatternPrompt({ genre: 'house', bpm: 120 })
	const anchors = prompt
		.split('\n')
		.filter((line) => /^(House\/disco|Techno|Funk\/breakbeat):/.test(line))
	expect(anchors).toHaveLength(3)
	for (const anchor of anchors) {
		expect(compileCheck(anchor.slice(anchor.indexOf(': ') + 2))).toEqual({
			ok: true,
		})
	}
})
