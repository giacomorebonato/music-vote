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
const MAX_QUESTION_CHARS = 120
const MAX_OPTION_CHARS = 32
const MAX_OPTIONS = 2
export const FALLBACK_QUESTION = 'Where should the set go next?'
export const FALLBACK_OPTIONS = ['more energy', 'deeper, darker groove']
const INITIAL_QUESTION = 'start set'
const INITIAL_WINNER = 'yes'
const INITIAL_SUMMARY = 'initial pattern'

/** Question plus the change options the audience votes between. */
export type GeneratedQuestion = {
	question: string
	options: string[]
}

// An option that means "do not change the music" makes the poll a no-op, so the
// model's options are filtered against this set; too few survivors fall back.
const NO_CHANGE_OPTION =
	/^(?:no|nope|yes|yep|yeah|no change|no changes|nothing|same|as is|keep(?: it)? as is|keep going|keep it|leave(?: it)? as is|status quo)[.!]?$/i

function stripListPrefix(line: string): string {
	return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()
}

function stripQuestionPrefix(line: string): string {
	return line.replace(/^\s*(?:q|question)\s*[:.-]\s*/i, '').trim()
}

function changeOptions(lines: string[]): string[] {
	const seen = new Set<string>()
	const options: string[] = []
	for (const line of lines) {
		const label = stripListPrefix(line)
		if (label.length === 0 || label.length > MAX_OPTION_CHARS) continue
		if (NO_CHANGE_OPTION.test(label)) continue
		const dedupeKey = label.toLowerCase()
		if (seen.has(dedupeKey)) continue
		seen.add(dedupeKey)
		options.push(label)
		if (options.length === MAX_OPTIONS) break
	}
	return options
}

/**
 * Parse a model answer into a question and its change options. Line-based so a
 * small local model never has to emit valid JSON: the first non-empty line is
 * the question, every following line is an option (bullets optional). A valid
 * question with fewer than two usable change options keeps the question and
 * pairs it with the canned changes, so a poll always offers a real choice.
 */
export function parseQuestionResponse(raw: string): GeneratedQuestion | null {
	const lines = raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
	const [first, ...rest] = lines
	if (first === undefined) return null

	const question = stripQuestionPrefix(first)
	if (question.length === 0 || question.length > MAX_QUESTION_CHARS) return null

	const options = changeOptions(rest)
	if (options.length >= 2) return { question, options }
	return { question, options: [...FALLBACK_OPTIONS] }
}

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
): Promise<GeneratedQuestion> {
	const prompt = buildQuestionPrompt(doc)

	for (let attempt = 0; attempt < MAX_QUESTION_ATTEMPTS; attempt++) {
		let raw: string
		try {
			raw = await provider.chat(prompt)
		} catch {
			continue
		}

		const parsed = parseQuestionResponse(raw)
		if (parsed) return parsed
	}

	return { question: FALLBACK_QUESTION, options: [...FALLBACK_OPTIONS] }
}
