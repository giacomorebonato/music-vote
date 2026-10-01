import type { LlmProvider } from '@backend/llm/provider'
import {
	buildEvolutionPrompt,
	buildInitialPatternPrompt,
	buildOutroPrompt,
	buildQuestionPrompt,
} from '@backend/music/prompts'
import {
	applyChange,
	initialStateDoc,
	type MusicParams,
	type StateDoc,
} from '@backend/music/state-doc'
import { compileCheck } from '@backend/music/validate'

export class MusicGenError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'MusicGenError'
	}
}

const MAX_CODE_ATTEMPTS = 2
const MAX_QUESTION_ATTEMPTS = 2
const FALLBACK_QUESTION = 'Do you want more energy? yes/no'
const INITIAL_QUESTION = 'start set'
const INITIAL_WINNER = 'yes'
const INITIAL_SUMMARY = 'initial pattern'

async function tryGenerateCode(
	provider: LlmProvider,
	prompt: string,
): Promise<string | null> {
	for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
		let raw: string
		try {
			raw = await provider.chat(prompt)
		} catch {
			continue
		}

		const check = compileCheck(raw)
		if (check.ok) {
			return raw
		}
	}

	return null
}

export async function generateInitialPattern(
	provider: LlmProvider,
	params: MusicParams,
): Promise<{ code: string; doc: StateDoc }> {
	const prompt = buildInitialPatternPrompt(params)
	const code = await tryGenerateCode(provider, prompt)

	if (code === null) {
		throw new MusicGenError(
			'Failed to generate a valid initial pattern after 2 attempts',
		)
	}

	const doc = applyChange(
		initialStateDoc(params),
		INITIAL_QUESTION,
		INITIAL_WINNER,
		INITIAL_SUMMARY,
	)

	return { code, doc }
}

// biome-ignore lint/complexity/useMaxParams: public orchestration signature mandated by Task 6 brief
export async function generateEvolution(
	provider: LlmProvider,
	doc: StateDoc,
	question: string,
	winner: string,
	currentCode: string,
): Promise<{ code: string; changeSummary: string } | null> {
	const prompt = buildEvolutionPrompt(doc, question, winner, currentCode)
	const code = await tryGenerateCode(provider, prompt)

	if (code === null) {
		return null
	}

	return { code, changeSummary: `${question} — winner: ${winner}` }
}

export async function generateOutro(
	provider: LlmProvider,
	doc: StateDoc,
	currentCode: string,
): Promise<string> {
	const prompt = buildOutroPrompt(doc, currentCode)
	const code = await tryGenerateCode(provider, prompt)

	if (code === null) {
		throw new MusicGenError('Failed to generate a valid outro after 2 attempts')
	}

	return code
}

export async function generateNextQuestion(
	provider: LlmProvider,
	doc: StateDoc,
): Promise<string> {
	const prompt = buildQuestionPrompt(doc)

	for (let attempt = 0; attempt < MAX_QUESTION_ATTEMPTS; attempt++) {
		let raw: string
		try {
			raw = await provider.chat(prompt)
		} catch {
			continue
		}

		const trimmed = raw.trim()
		if (trimmed.length > 0 && trimmed.length <= 120) {
			return trimmed
		}
	}

	return FALLBACK_QUESTION
}
