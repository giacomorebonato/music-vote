import { expect, test } from 'bun:test'
import { compileCheck } from '@backend/music/validate'

test('accepts valid drum pattern', () => {
	expect(compileCheck('s("bd sd cp hh")')).toEqual({ ok: true })
})

test('accepts setcps piece', () => {
	expect(compileCheck('setcps(1)\nn("c e g").s()')).toEqual({ ok: true })
})

test('rejects unbalanced parenthesis', () => {
	const result = compileCheck('s("bd sd')
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('Unterminated')
})

test('rejects invalid mini pattern syntax', () => {
	const result = compileCheck('s("bd [sd")')
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('mini')
})

test('rejects sound name missing from the dirt-samples bank', () => {
	const result = compileCheck('s("[~ oh]*4")')
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('unknown sound: oh')
})

test('rejects unknown sound in a full multi-line pattern (repro of live bug)', () => {
	const code = [
		'setcps(0.5)',
		'',
		'$: s("bd*4").gain(0.9)',
		'$: s("~ cp ~ cp").room(0.2).gain(0.7)',
		'$: s("[hh ~]*4").gain(0.3).every(4, fast(2))',
		'$: s("[~ oh]*4").gain(0.5)',
	].join('\n')
	expect(compileCheck(code).ok).toBe(false)
})

test('accepts valid open-hat sound names from the bank', () => {
	expect(compileCheck('s("[~ ho]*4").gain(0.5)')).toEqual({ ok: true })
	expect(compileCheck('s("808oh hh27")')).toEqual({ ok: true })
})

test('accepts synth sounds and aliases', () => {
	expect(compileCheck('note("c2").s("sawtooth")')).toEqual({ ok: true })
	expect(compileCheck('n("0 3 7").s("tri")')).toEqual({ ok: true })
	expect(compileCheck('s("supersaw")')).toEqual({ ok: true })
})

test('accepts numeric sample keys, colon indices and multipliers', () => {
	expect(compileCheck('s("808")')).toEqual({ ok: true })
	expect(compileCheck('s("amencutup:2")')).toEqual({ ok: true })
	expect(compileCheck('s("bd*2 [~ sd] cp [hh hh]")')).toEqual({ ok: true })
})

test('skips sound validation for non-literal s arguments', () => {
	expect(compileCheck("const x = 'bd'\ns(x)")).toEqual({ ok: true })
})

test('rejects fetch call', () => {
	const result = compileCheck("s('bd').play(); fetch('/steal')")
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('blocked')
})

test('rejects dynamic import', () => {
	const result = compileCheck("import('evil')")
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('blocked')
})

test('rejects require', () => {
	const result = compileCheck("require('fs').readFileSync('/etc/passwd')")
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('blocked')
})

test('rejects XMLHttpRequest', () => {
	const result = compileCheck('new XMLHttpRequest()')
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('blocked')
})

test('rejects document access', () => {
	const result = compileCheck('document.body.innerHTML')
	expect(result.ok).toBe(false)
	if (!result.ok) expect(result.error).toContain('blocked')
})
