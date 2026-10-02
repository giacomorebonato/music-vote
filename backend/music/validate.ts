import { KNOWN_SOUNDS } from '@backend/music/strudel-sounds'
import { transpiler as strudelTranspiler } from '@strudel/transpiler'

type CompileResult = { ok: true } | { ok: false; error: string }

const blocklist = [
	{ name: 'fetch', pattern: /\bfetch\(/ },
	{ name: 'dynamic import', pattern: /\bimport\(/ },
	{ name: 'require', pattern: /\brequire\(/ },
	{ name: 'XMLHttpRequest', pattern: /XMLHttpRequest/ },
	{ name: 'document', pattern: /document\./ },
]

// Sound names inside literal s(...) mini-notation. Word-like segments are
// candidate sound names; pure digits are multipliers (*4), speeds (/2) or
// sample indices (bd:3) unless the bank actually keys a numeric sound (808).
const S_CALL_PATTERN = /(?:\.\s*)?\bs\s*\(\s*(['"`])((?:(?!\1).)*)\1/gs
const WORD_PATTERN = /[A-Za-z0-9_]+/g

function checkSoundNames(code: string): string | null {
	for (const call of code.matchAll(S_CALL_PATTERN)) {
		for (const word of call[2].match(WORD_PATTERN) ?? []) {
			if (KNOWN_SOUNDS.has(word)) continue
			if (/^[0-9]+$/.test(word)) continue
			return word
		}
	}
	return null
}

export function compileCheck(code: string): CompileResult {
	for (const { name, pattern } of blocklist) {
		if (pattern.test(code)) {
			return { ok: false, error: `blocked: disallowed pattern (${name})` }
		}
	}

	try {
		strudelTranspiler(code)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { ok: false, error: message }
	}

	const unknownSound = checkSoundNames(code)
	if (unknownSound) {
		return { ok: false, error: `unknown sound: ${unknownSound}` }
	}

	return { ok: true }
}
