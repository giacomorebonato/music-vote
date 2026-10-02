import { expect, test } from 'bun:test'
import {
	buildEvolutionPrompt,
	buildInitialPatternPrompt,
	buildOutroPrompt,
	buildQuestionPrompt,
	FEW_SHOTS,
	SOUND_HINTS,
} from '@backend/music/prompts'
import {
	applyChange,
	initialStateDoc,
	type StateDoc,
} from '@backend/music/state-doc'
import { compileCheck } from '@backend/music/validate'

const params = { genre: 'techno', bpm: 132 }
const currentCode = 's("bd sd cp hh")'
const question = 'Add a punchier kick?'

function votedDoc(): StateDoc {
	return applyChange(
		initialStateDoc(params),
		question,
		'yes',
		'added a punchier kick',
	)
}

test('FEW_SHOTS: at least 3 snippets, all valid strudel', () => {
	expect(FEW_SHOTS.length).toBeGreaterThanOrEqual(3)
	for (const snippet of FEW_SHOTS) {
		expect(compileCheck(snippet).ok).toBe(true)
	}
})

test('every prompt carries genre, bpm and few-shot snippets', () => {
	const prompts = [
		buildInitialPatternPrompt(params),
		buildQuestionPrompt(votedDoc()),
		buildEvolutionPrompt(votedDoc(), question, 'yes', currentCode),
		buildOutroPrompt(votedDoc(), currentCode),
	]

	for (const prompt of prompts) {
		expect(prompt).toContain('techno')
		expect(prompt).toContain('132')
		expect(prompt).toContain(FEW_SHOTS[0] ?? '')
		expect(prompt).toContain(FEW_SHOTS[1] ?? '')
	}
})

test('code prompts constrain the model to available sound names', () => {
	const prompts = [
		buildInitialPatternPrompt(params),
		buildEvolutionPrompt(votedDoc(), question, 'yes', currentCode),
		buildOutroPrompt(votedDoc(), currentCode),
	]
	for (const prompt of prompts) {
		expect(prompt).toContain('AVAILABLE SOUNDS')
		expect(prompt).toContain('use ONLY these names')
		expect(prompt).toContain('ho')
		expect(prompt).toContain('no `oh` sample exists')
	}
})

test('SOUND_HINTS all validate against the allowlist', () => {
	expect(compileCheck(`s("${SOUND_HINTS.join(' ')}")`).ok).toBe(true)
})

test('code prompts forbid prose and markdown fences', () => {
	const prompts = [
		buildInitialPatternPrompt(params),
		buildEvolutionPrompt(votedDoc(), question, 'yes', currentCode),
		buildOutroPrompt(votedDoc(), currentCode),
	]

	for (const prompt of prompts) {
		expect(prompt).toContain('strudel.js code')
		expect(prompt).toContain('no prose')
		expect(prompt).toContain('no markdown fences')
	}
})

test('initial pattern prompt asks for a loopable pattern at the room bpm', () => {
	const prompt = buildInitialPatternPrompt(params)
	expect(prompt).toContain('setcps(0.55)')
	expect(prompt).toContain('techno')
})

test('evolution prompt carries current code, poll result, history and one-change rule', () => {
	const prompt = buildEvolutionPrompt(votedDoc(), question, 'yes', currentCode)

	expect(prompt).toContain(currentCode)
	expect(prompt).toContain(question)
	expect(prompt).toContain('yes')
	expect(prompt).toContain('techno')
	expect(prompt).toContain('132')
	expect(prompt).toMatch(/exactly ONE change/)
	expect(prompt).toContain('added a punchier kick')
})

test('evolution prompt renders empty history as none yet', () => {
	const prompt = buildEvolutionPrompt(
		initialStateDoc(params),
		question,
		'yes',
		currentCode,
	)
	expect(prompt).toContain('Change history:\nnone yet')
})

test('outro prompt carries current code and the code-only rule', () => {
	const prompt = buildOutroPrompt(votedDoc(), currentCode)

	expect(prompt).toContain(currentCode)
	expect(prompt).toContain('outro')
	expect(prompt).toContain('techno')
})

test('question prompt: a question plus at least two change options, no repeats, paced', () => {
	const doc = votedDoc()
	const prompt = buildQuestionPrompt(doc)

	expect(prompt).toContain('at least two answer options')
	expect(prompt).toContain('first line')
	expect(prompt).toContain('keep it as is')
	expect(prompt).toContain('120')
	expect(prompt).toContain('60')
	expect(prompt).toContain(doc.polledDimensions.join(', '))
	expect(prompt).toContain('pace the evolution')
	expect(prompt).toContain('techno')
	expect(prompt).toContain('132')
})

test('question prompt renders empty polled dimensions as none yet', () => {
	const prompt = buildQuestionPrompt(initialStateDoc(params))
	expect(prompt).toContain('none yet')
})
