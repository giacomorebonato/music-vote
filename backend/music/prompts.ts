import type { MusicParams, StateDoc } from '@backend/music/state-doc'

// Short, real Strudel snippets shown to the model as style anchors.
export const FEW_SHOTS = [
	's("bd sd cp hh")',
	's("bd*2 [~ sd] cp [hh hh]").gain(0.9)',
	'note("c2 ~ eb2 g2").s("sawtooth").lpf(600).gain(0.7)',
	'setcps(0.5)\nn("0 3 7 10").scale("C:minor").s("triangle").delay(0.4)',
]

// The provider strips markdown fences, but only for a single, well-formed
// fence: prose before a fence or several fences leak through. Keep the
// prohibition explicit in every code-producing prompt.
const CODE_ONLY_RULE =
	'Output ONLY strudel.js code, no prose, no markdown fences.'

function bpmToCps(bpm: number): number {
	return Math.round((bpm / 240) * 1000) / 1000
}

function fewShotsBlock(): string {
	return [
		'FEW-SHOT STRUDEL EXAMPLES:',
		...FEW_SHOTS.map((snippet) => `- ${snippet}`),
	].join('\n')
}

function elementsBlock(doc: StateDoc): string {
	const { drums, bass, melody, harmony, soundDesign } = doc.elements
	const parts: string[] = []
	if (drums) parts.push('drums')
	if (bass) parts.push('bass')
	if (melody) parts.push('melody')
	if (harmony) parts.push('harmony')
	if (soundDesign.length > 0) {
		parts.push(`sound design (${soundDesign.join('; ')})`)
	}
	return parts.length === 0
		? 'nothing beyond the base loop yet'
		: parts.join(', ')
}

function historyBlock(doc: StateDoc): string {
	if (doc.history.length === 0) return 'none yet'
	return doc.history
		.map(
			(entry) =>
				`- asked "${entry.question}" -> winner: ${entry.winner} -> ${entry.changeSummary ?? 'no change applied'}`,
		)
		.join('\n')
}

function polledBlock(doc: StateDoc): string {
	return doc.polledDimensions.length === 0
		? 'none yet'
		: doc.polledDimensions.join(', ')
}

export function buildInitialPatternPrompt(params: MusicParams): string {
	return [
		`Write the opening Strudel pattern for a live ${params.genre} set at ${params.bpm} BPM.`,
		`Start with setcps(${bpmToCps(params.bpm)}) so one cycle is one bar (4 beats) at ${params.bpm} BPM.`,
		'Build a loopable groove: drums plus the bass, melody or harmony this genre needs. Keep it playable on its own for minutes.',
		'',
		fewShotsBlock(),
		'',
		CODE_ONLY_RULE,
	].join('\n')
}

export function buildQuestionPrompt(doc: StateDoc): string {
	return [
		`You are the MC of a live ${doc.genre} set at ${doc.bpm} BPM that evolves through audience votes.`,
		'',
		`Elements present: ${elementsBlock(doc)}`,
		`Change history: ${historyBlock(doc)}`,
		`Dimensions already polled (do not repeat these): ${polledBlock(doc)}`,
		'',
		fewShotsBlock(),
		'',
		'Ask the audience about the next change.',
		'Output ONE yes/no question, nothing else. Max 120 characters.',
		'Never repeat a dimension already polled, never ask about code or technical terms, and pace the evolution: do not stack another melody or a third layer right after one was added.',
	].join('\n')
}

export function buildEvolutionPrompt(
	doc: StateDoc,
	question: string,
	winner: string,
	currentCode: string,
): string {
	return [
		`Update this live ${doc.genre} Strudel pattern (${doc.bpm} BPM) after an audience vote.`,
		'',
		'Current pattern:',
		currentCode,
		'',
		`Poll question: "${question}"`,
		`Winning vote: ${winner}`,
		`Elements present: ${elementsBlock(doc)}`,
		'',
		'Change history:',
		historyBlock(doc),
		'',
		fewShotsBlock(),
		'',
		'Change exactly ONE dimension of the pattern. The winning vote only decides whether that one change happens, never how many things change. Keep every other element exactly as it is, keep the same tempo, and keep the pattern loopable.',
		CODE_ONLY_RULE,
	].join('\n')
}

export function buildOutroPrompt(doc: StateDoc, currentCode: string): string {
	return [
		`Write the outro that ends this live ${doc.genre} set (${doc.bpm} BPM) on a resolved note.`,
		'',
		'Current pattern:',
		currentCode,
		`Elements present: ${elementsBlock(doc)}`,
		'',
		fewShotsBlock(),
		'',
		'Resolve the set: sweep or fade the filter, drop elements one at a time, and land on a sustained final hit or chord. Finish within about 8 cycles and keep the tempo.',
		CODE_ONLY_RULE,
	].join('\n')
}
