import { expect, test } from 'bun:test'
import { type LlmProvider, MockLlmProvider } from '@backend/llm/provider'
import {
	generateEvolution,
	generateInitialPattern,
	generateNextQuestion,
	generateOutro,
	MusicGenError,
} from '@backend/music/engine'
import { initialStateDoc } from '@backend/music/state-doc'

class ThrowingProvider implements LlmProvider {
	calls = 0

	async chat(): Promise<string> {
		this.calls++
		throw new Error('timeout')
	}
}

const params = { genre: 'techno', bpm: 132 }
const validCode = 's("bd sd cp hh")'
const invalidCode = 's("bd sd'
const fetchCode = "fetch('/evil')"
const fallbackQuestion = 'Do you want more energy? yes/no'
const longQuestion = 'x'.repeat(121)

function callsMade(provider: MockLlmProvider, initial: string[]): number {
	return (
		initial.length -
		(provider as unknown as { responses: string[] }).responses.length
	)
}

// --- generateInitialPattern ---

test('generateInitialPattern: happy path returns validated code and seeded doc', async () => {
	const provider = new MockLlmProvider([validCode])
	const { code, doc } = await generateInitialPattern(provider, params)

	expect(code).toBe(validCode)
	expect(doc.genre).toBe('techno')
	expect(doc.bpm).toBe(132)
	expect(doc.history).toHaveLength(1)
	expect(doc.history[0]).toMatchObject({
		question: 'start set',
		winner: 'yes',
		changeSummary: 'initial pattern',
	})
	expect(callsMade(provider, [validCode])).toBe(1)
})

test('generateInitialPattern: invalid-then-valid retries once and makes exactly 2 calls', async () => {
	const responses = [invalidCode, validCode]
	const provider = new MockLlmProvider(responses)
	const { code } = await generateInitialPattern(provider, params)

	expect(code).toBe(validCode)
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateInitialPattern: twice-invalid throws MusicGenError after 2 calls', async () => {
	const responses = [invalidCode, invalidCode]
	const provider = new MockLlmProvider(responses)

	await expect(generateInitialPattern(provider, params)).rejects.toThrow(
		MusicGenError,
	)
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateInitialPattern: provider throw follows retry-then-throw path', async () => {
	const provider = new ThrowingProvider()

	await expect(generateInitialPattern(provider, params)).rejects.toThrow(
		MusicGenError,
	)
	expect(provider.calls).toBe(2)
})

// --- generateEvolution ---

test('generateEvolution: happy path returns validated code and derived change summary', async () => {
	const provider = new MockLlmProvider([validCode])
	const doc = initialStateDoc(params)
	const result = await generateEvolution(
		provider,
		doc,
		'Add bass?',
		'yes',
		validCode,
	)

	expect(result).not.toBeNull()
	expect(result?.code).toBe(validCode)
	expect(result?.changeSummary).toBe('Add bass? — winner: yes')
	expect(callsMade(provider, [validCode])).toBe(1)
})

test('generateEvolution: invalid-then-valid retries once and makes exactly 2 calls', async () => {
	const responses = [invalidCode, validCode]
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)
	const result = await generateEvolution(
		provider,
		doc,
		'Add bass?',
		'yes',
		validCode,
	)

	expect(result?.code).toBe(validCode)
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateEvolution: twice-invalid returns null after 2 calls', async () => {
	const responses = [invalidCode, invalidCode]
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)
	const result = await generateEvolution(
		provider,
		doc,
		'Add bass?',
		'yes',
		validCode,
	)

	expect(result).toBeNull()
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateEvolution: fetch-containing code is rejected by compileCheck guard', async () => {
	const responses = [fetchCode, validCode]
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)
	const result = await generateEvolution(
		provider,
		doc,
		'Add bass?',
		'yes',
		validCode,
	)

	expect(result?.code).toBe(validCode)
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateEvolution: provider throw returns null after 2 attempts', async () => {
	const provider = new ThrowingProvider()
	const doc = initialStateDoc(params)
	const result = await generateEvolution(
		provider,
		doc,
		'Add bass?',
		'yes',
		validCode,
	)

	expect(result).toBeNull()
	expect(provider.calls).toBe(2)
})

// --- generateOutro ---

test('generateOutro: happy path returns validated code', async () => {
	const provider = new MockLlmProvider([validCode])
	const doc = initialStateDoc(params)
	const outro = await generateOutro(provider, doc, validCode)

	expect(outro).toBe(validCode)
	expect(callsMade(provider, [validCode])).toBe(1)
})

test('generateOutro: invalid-then-valid retries once and makes exactly 2 calls', async () => {
	const responses = [invalidCode, validCode]
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)
	const outro = await generateOutro(provider, doc, validCode)

	expect(outro).toBe(validCode)
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateOutro: twice-invalid throws MusicGenError after 2 calls', async () => {
	const responses = [invalidCode, invalidCode]
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)

	await expect(generateOutro(provider, doc, validCode)).rejects.toThrow(
		MusicGenError,
	)
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateOutro: provider throw follows retry-then-throw path', async () => {
	const provider = new ThrowingProvider()
	const doc = initialStateDoc(params)

	await expect(generateOutro(provider, doc, validCode)).rejects.toThrow(
		MusicGenError,
	)
	expect(provider.calls).toBe(2)
})

// --- generateNextQuestion ---

test('generateNextQuestion: happy path returns trimmed question', async () => {
	const provider = new MockLlmProvider(['  Add more bass?  '])
	const doc = initialStateDoc(params)
	const question = await generateNextQuestion(provider, doc)

	expect(question).toBe('Add more bass?')
	expect(callsMade(provider, ['  Add more bass?  '])).toBe(1)
})

test('generateNextQuestion: empty-then-valid retries once and returns valid question', async () => {
	const responses = ['   ', 'Add more bass?']
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)
	const question = await generateNextQuestion(provider, doc)

	expect(question).toBe('Add more bass?')
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateNextQuestion: oversized-then-valid retries once and returns valid question', async () => {
	const responses = [longQuestion, 'Add more bass?']
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)
	const question = await generateNextQuestion(provider, doc)

	expect(question).toBe('Add more bass?')
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateNextQuestion: twice-invalid falls back to canned question after 2 calls', async () => {
	const responses = [longQuestion, '   ']
	const provider = new MockLlmProvider(responses)
	const doc = initialStateDoc(params)
	const question = await generateNextQuestion(provider, doc)

	expect(question).toBe(fallbackQuestion)
	expect(callsMade(provider, responses)).toBe(2)
})

test('generateNextQuestion: provider throw falls back to canned question after 2 attempts', async () => {
	const provider = new ThrowingProvider()
	const doc = initialStateDoc(params)
	const question = await generateNextQuestion(provider, doc)

	expect(question).toBe(fallbackQuestion)
	expect(provider.calls).toBe(2)
})
