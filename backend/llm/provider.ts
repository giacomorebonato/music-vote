import { readFileSync } from 'node:fs'

export type LlmChatOptions = { system?: string; temperature?: number }

export interface LlmProvider {
	chat(prompt: string, opts?: LlmChatOptions): Promise<string>
}

export type OllamaConfig = {
	baseUrl: string
	model: string
	apiKey?: string
}

// Ollama returns the assistant reply as { message: { content } }. LLMs often
// wrap the requested Strudel code in a single markdown fence despite the prompt
// forbidding it; downstream consumers (MusicEngine) need clean text.
function stripCodeFences(content: string): string {
	const multiline = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(content)
	if (multiline) return multiline[1].trim()
	const inline = /^```([^`]*?)```\s*$/.exec(content)
	if (inline) return inline[1].trim()
	return content
}

export class OllamaProvider implements LlmProvider {
	private readonly baseUrl: string
	private readonly model: string
	private readonly apiKey: string | undefined

	constructor({ baseUrl, model, apiKey }: OllamaConfig) {
		this.baseUrl = baseUrl.replace(/\/$/, '')
		this.model = model
		this.apiKey = apiKey
	}

	async chat(prompt: string, opts?: LlmChatOptions): Promise<string> {
		const messages: { role: 'system' | 'user'; content: string }[] = []
		if (opts?.system) messages.push({ role: 'system', content: opts.system })
		messages.push({ role: 'user', content: prompt })

		const body: Record<string, unknown> = {
			model: this.model,
			messages,
			stream: false,
		}
		if (opts?.temperature !== undefined) {
			body.options = { temperature: opts.temperature }
		}

		const headers: Record<string, string> = {
			'content-type': 'application/json',
		}
		if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		})
		if (!response.ok) {
			throw new Error(`Ollama chat failed: ${response.status}`)
		}

		const data = (await response.json()) as {
			message?: { content?: unknown }
		}
		const content = data.message?.content
		if (typeof content !== 'string') {
			throw new Error('Ollama chat response missing message.content')
		}
		return stripCodeFences(content)
	}
}

function readScriptFile(path: string): string[] {
	const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
		responses?: unknown
	}
	const responses = parsed.responses
	if (
		!Array.isArray(responses) ||
		!responses.every((item) => typeof item === 'string')
	) {
		throw new Error(
			`LLM_MOCK_SCRIPT must contain { responses: string[] }: ${path}`,
		)
	}
	return responses
}

// Scripted provider for tests. Resolution order: explicit constructor array,
// then the LLM_MOCK_SCRIPT fixture file, then throw. Pops in order and throws
// once exhausted so tests never fall back to a real model.
export class MockLlmProvider implements LlmProvider {
	private readonly responses: string[]

	constructor(responses?: string[]) {
		if (responses !== undefined) {
			this.responses = [...responses]
			return
		}
		const scriptPath = process.env.LLM_MOCK_SCRIPT
		if (!scriptPath) {
			throw new Error('MockLlmProvider: pass responses or set LLM_MOCK_SCRIPT')
		}
		this.responses = readScriptFile(scriptPath)
	}

	async chat(_prompt: string, _opts?: LlmChatOptions): Promise<string> {
		const next = this.responses.shift()
		if (next === undefined) {
			throw new Error('MockLlmProvider: scripted responses exhausted')
		}
		return next
	}
}

export function getLlmProvider(): LlmProvider {
	// An empty or whitespace-only value is treated as unset: a deploy that sets
	// `LLM_PROVIDER=` must fall back to the default rather than throw
	// `Unknown LLM_PROVIDER: ` at the first room start. A non-empty unknown
	// value still throws.
	const kind = process.env.LLM_PROVIDER?.trim() || 'ollama'
	if (kind === 'mock') return new MockLlmProvider()
	if (kind === 'ollama') {
		const model = process.env.OLLAMA_MODEL
		if (!model) {
			throw new Error('OLLAMA_MODEL is required for LLM_PROVIDER=ollama')
		}
		return new OllamaProvider({
			baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
			model,
			apiKey: process.env.OLLAMA_API_KEY || undefined,
		})
	}
	throw new Error(`Unknown LLM_PROVIDER: ${kind}`)
}
