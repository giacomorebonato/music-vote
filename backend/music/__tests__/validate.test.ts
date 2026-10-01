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
