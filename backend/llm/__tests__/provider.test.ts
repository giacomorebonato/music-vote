import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	getLlmProvider,
	MockLlmProvider,
	OllamaProvider,
} from '@backend/llm/provider'

const LLM_ENV_KEYS = [
	'LLM_PROVIDER',
	'LLM_MOCK_SCRIPT',
	'OLLAMA_BASE_URL',
	'OLLAMA_MODEL',
	'OLLAMA_API_KEY',
] as const

const originalFetch = globalThis.fetch

beforeEach(() => {
	for (const key of LLM_ENV_KEYS) delete process.env[key]
})

afterEach(() => {
	for (const key of LLM_ENV_KEYS) delete process.env[key]
	globalThis.fetch = originalFetch
})

type FetchCall = { url: string; init: RequestInit }

function stubFetch(response: unknown): FetchCall[] {
	const calls: FetchCall[] = []
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		calls.push({ url: String(input), init: init ?? {} })
		return new Response(JSON.stringify(response), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	}) as typeof fetch
	return calls
}

function writeScriptFile(responses: string[]): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), 'mv-llm-'))
	const path = join(dir, 'llm-script.json')
	writeFileSync(path, JSON.stringify({ responses }))
	return { dir, path }
}

// --- MockLlmProvider ---

test('mock returns scripted responses in order', async () => {
	const provider = new MockLlmProvider(['first', 'second'])
	expect(await provider.chat('a')).toBe('first')
	expect(await provider.chat('b')).toBe('second')
})

test('mock throws on exhaustion', async () => {
	const provider = new MockLlmProvider(['only'])
	await provider.chat('a')
	await expect(provider.chat('b')).rejects.toThrow()
})

test('mock constructor responses win over LLM_MOCK_SCRIPT', async () => {
	const { dir, path } = writeScriptFile(['from-file'])
	try {
		process.env.LLM_MOCK_SCRIPT = path
		const provider = new MockLlmProvider(['from-constructor'])
		expect(await provider.chat('a')).toBe('from-constructor')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('mock reads LLM_MOCK_SCRIPT file when no constructor responses', async () => {
	const { dir, path } = writeScriptFile(['env-one', 'env-two'])
	try {
		process.env.LLM_MOCK_SCRIPT = path
		const provider = new MockLlmProvider()
		expect(await provider.chat('a')).toBe('env-one')
		expect(await provider.chat('b')).toBe('env-two')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('mock throws when neither constructor responses nor LLM_MOCK_SCRIPT set', () => {
	expect(() => new MockLlmProvider()).toThrow()
})

// --- OllamaProvider ---

test('ollama POSTs exact chat body with system message', async () => {
	const calls = stubFetch({ message: { content: 'hello' } })
	const provider = new OllamaProvider({
		baseUrl: 'http://localhost:11434',
		model: 'llama3',
	})
	const result = await provider.chat('hi there', { system: 'be terse' })

	expect(result).toBe('hello')
	expect(calls).toHaveLength(1)
	expect(calls[0]?.url).toBe('http://localhost:11434/api/chat')
	expect(calls[0]?.init.method).toBe('POST')
	expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
		model: 'llama3',
		messages: [
			{ role: 'system', content: 'be terse' },
			{ role: 'user', content: 'hi there' },
		],
		stream: false,
	})
})

test('ollama omits system message when opts.system not provided', async () => {
	const calls = stubFetch({ message: { content: 'ok' } })
	const provider = new OllamaProvider({
		baseUrl: 'http://localhost:11434',
		model: 'llama3',
	})
	await provider.chat('hi')

	expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
		model: 'llama3',
		messages: [{ role: 'user', content: 'hi' }],
		stream: false,
	})
})

test('ollama sends Bearer header when API key set', async () => {
	const calls = stubFetch({ message: { content: 'ok' } })
	const provider = new OllamaProvider({
		baseUrl: 'http://localhost:11434',
		model: 'llama3',
		apiKey: 'secret-key',
	})
	await provider.chat('hi')

	expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(
		'Bearer secret-key',
	)
})

test('ollama sends no Authorization header when API key unset', async () => {
	const calls = stubFetch({ message: { content: 'ok' } })
	const provider = new OllamaProvider({
		baseUrl: 'http://localhost:11434',
		model: 'llama3',
	})
	await provider.chat('hi')

	expect(new Headers(calls[0]?.init.headers).get('authorization')).toBeNull()
})

test('ollama passes temperature through options when provided', async () => {
	const calls = stubFetch({ message: { content: 'ok' } })
	const provider = new OllamaProvider({
		baseUrl: 'http://localhost:11434',
		model: 'llama3',
	})
	await provider.chat('hi', { temperature: 0.7 })

	expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
		options: { temperature: 0.7 },
	})
})

test('ollama strips markdown code fences from response', async () => {
	stubFetch({ message: { content: '```js\ns("bd sd")\n```' } })
	const provider = new OllamaProvider({
		baseUrl: 'http://localhost:11434',
		model: 'llama3',
	})
	expect(await provider.chat('hi')).toBe('s("bd sd")')
})

test('ollama leaves unfenced content untouched', async () => {
	stubFetch({ message: { content: 's("bd sd")' } })
	const provider = new OllamaProvider({
		baseUrl: 'http://localhost:11434',
		model: 'llama3',
	})
	expect(await provider.chat('hi')).toBe('s("bd sd")')
})

// --- Factory ---

test('factory defaults to OllamaProvider', () => {
	process.env.OLLAMA_MODEL = 'llama3'
	expect(getLlmProvider()).toBeInstanceOf(OllamaProvider)
})

test('factory picks MockLlmProvider when LLM_PROVIDER=mock', () => {
	process.env.LLM_PROVIDER = 'mock'
	const { dir, path } = writeScriptFile(['x'])
	try {
		process.env.LLM_MOCK_SCRIPT = path
		expect(getLlmProvider()).toBeInstanceOf(MockLlmProvider)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('factory throws for unknown LLM_PROVIDER', () => {
	process.env.LLM_PROVIDER = 'bogus'
	expect(() => getLlmProvider()).toThrow('Unknown LLM_PROVIDER: bogus')
})

test('factory treats an empty LLM_PROVIDER as unset', () => {
	process.env.OLLAMA_MODEL = 'llama3'
	process.env.LLM_PROVIDER = ''
	expect(getLlmProvider()).toBeInstanceOf(OllamaProvider)
})

test('factory treats a whitespace-only LLM_PROVIDER as unset', () => {
	process.env.OLLAMA_MODEL = 'llama3'
	process.env.LLM_PROVIDER = '   '
	expect(getLlmProvider()).toBeInstanceOf(OllamaProvider)
})
