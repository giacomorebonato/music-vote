import { transpiler as strudelTranspiler } from '@strudel/transpiler'

type CompileResult = { ok: true } | { ok: false; error: string }

const blocklist = [
	{ name: 'fetch', pattern: /\bfetch\(/ },
	{ name: 'dynamic import', pattern: /\bimport\(/ },
	{ name: 'require', pattern: /\brequire\(/ },
	{ name: 'XMLHttpRequest', pattern: /XMLHttpRequest/ },
	{ name: 'document', pattern: /document\./ },
]

export function compileCheck(code: string): CompileResult {
	for (const { name, pattern } of blocklist) {
		if (pattern.test(code)) {
			return { ok: false, error: `blocked: disallowed pattern (${name})` }
		}
	}

	try {
		strudelTranspiler(code)
		return { ok: true }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { ok: false, error: message }
	}
}
