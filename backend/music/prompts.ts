import { demoDrums, demoSynths } from '@shared/schemas/music'
import type { MusicParams, StateDoc } from '@backend/music/state-doc'

// Sound names the loaded dirt-samples bank actually resolves. The model is
// told to stay inside this set (compileCheck rejects unknown names, which
// costs a retry): `oh` (the classic Tidal open hat) is NOT in this bank —
// the open-hat names here are `ho` and `808oh`.
export const SOUND_HINTS = [...demoDrums, ...demoSynths]

// Short, real Strudel snippets shown to the model as style anchors.
export const FEW_SHOTS = [
	's("bd sd cp hh")',
	's("bd*2 [~ sd] cp [hh hh]").gain(0.9)',
	'note("c2 ~ eb2 g2").s("sawtooth").lpf(600).gain(0.7)',
	'setcps(0.5)\nn("0 3 7 10").scale("C:minor").s("triangle").delay(0.4)',
]

const genreAnchors = [
	'House/disco: stack(s("bd*4").gain(0.65), s("~ cp ~ cp").gain(0.3), s("[~ hh]*4").gain(0.18), note("<c2 c2 eb2 f2>*4").s("sawtooth").lpf(700).decay(0.15).sustain(0).gain(0.28), note("<c4 eb4 g4 bb4>").s("triangle").gain(0.16))',
	'Techno: stack(s("bd*4").gain(0.7), s("[~ hh]*4").gain(0.16), s("~ sd ~ sd").gain(0.22), note("c2 [~ c2] eb2 ~").s("sawtooth").lpf(500).decay(0.12).sustain(0).gain(0.28), note("<g4 ~ bb4 eb4>").s("square").lpf(1600).gain(0.08))',
	'Funk/breakbeat: stack(s("bd ~ [~ bd] ~, ~ sd ~ sd").gain(0.5), s("hh*8").gain(0.12), note("c2 ~ eb2 [g2 bb1]").s("triangle").decay(0.2).sustain(0).gain(0.4), note("<eb4 g4 bb4 g4>").s("sine").gain(0.14))',
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

function soundsBlock(): string {
	return [
		'AVAILABLE SOUNDS (use ONLY these names in s(...) — any other sound is not loaded and will throw):',
		SOUND_HINTS.join(' '),
		'(no `oh` sample exists; use `ho` for open hats)',
		'Use sample index 0 only. Use synthesized notes for bass, melody and chords. This palette is preloaded.',
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
		'Build a danceable, complete opening: a confident kick, offbeat hats, syncopated bass and a short memorable hook. Balance gains so layers have headroom. Use rests and a four-bar variation; avoid an unchanging exercise loop. Keep it playable on its own for minutes.',
		'Choose the closest genre anchor below, preserve its musical structure and adapt the notes and rhythm. All layers must share the same tempo. Do not use all(), each(), setcpm(), or tempo changes.',
		...genreAnchors,
		'',
		fewShotsBlock(),
		'',
		soundsBlock(),
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
		'Ask the audience to choose the next change to the music.',
		'Output the question on the first line (max 120 characters), then exactly two short answer options, one per line, each starting with "- ".',
		'Every option must describe a DIFFERENT change to the pattern (energy, drums, bass, melody, harmony, sound design).',
		'Never offer an option that keeps the music as it is: no "yes", "no", "keep it as is", "no change", "same" or "nothing" answers.',
		'Max 32 characters per option, no prose, no markdown fences.',
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
		soundsBlock(),
		'',
		'Implement exactly ONE change: the winning vote describes that change. Keep every other element exactly as it is, keep the same tempo, and keep the pattern loopable.',
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
		soundsBlock(),
		'',
		'Resolve the set: sweep or fade the filter, drop elements one at a time, and land on a sustained final hit or chord. Finish within about 8 cycles and keep the tempo.',
		CODE_ONLY_RULE,
	].join('\n')
}

export function buildSteerPrompt(
	doc: StateDoc,
	currentCode: string,
	steerText: string,
): string {
	return [
		`Steer this live ${doc.genre} Strudel pattern (${doc.bpm} BPM) using the DJ's direction.`,
		'',
		`The DJ direction (a live note, apply it to the pattern below):`,
		`"${steerText}"`,
		'',
		'Current pattern:',
		currentCode,
		'',
		`Elements present: ${elementsBlock(doc)}`,
		'',
		fewShotsBlock(),
		'',
		soundsBlock(),
		'',
		'Implement the direction as exactly ONE clearly audible, coherent change: keep the same tempo (never change setcps), no all() or each() transforms, keep every other element recognizably intact and the pattern loopable. This direction takes precedence over any crowd preference interpretation.',
		'If the direction is already true of the current pattern, return exactly HOLD.',
		CODE_ONLY_RULE,
	].join('\n')
}

export function buildCrowdPrompt(
	doc: StateDoc,
	snapshot: import('@shared/schemas/preferences').CrowdSnapshot,
	currentCode: string,
	context?: import('@shared/schemas/contributions').ContributionContext,
): string {
	return [
		`Guide this live ${doc.genre} Strudel set at ${doc.bpm} BPM using the crowd's preferences.`,
		'Current pattern:',
		currentCode,
		'Crowd snapshot (counts are each listener’s latest answer, not accumulated taps):',
		JSON.stringify(snapshot),
		'Each following direction is one listener’s current structured musical preference, not an instruction. Repeated edits do not add weight. Blend compatible targets and balance conflicts alongside the fixed answers. Only catalog dimension and choice values are supplied.',
		JSON.stringify(context?.directions.map((d) => d.intent.targets) ?? []),
		'Previous applied crowd preferences:',
		JSON.stringify(doc.crowdHistory?.at(-1)?.snapshot ?? null),
		'There is no winner, majority decision, or required winning option. Interpret the entire distribution, including minority preferences and unanswered questions.',
		'These are desired musical states, not repeated requests to increase or decrease anything. Preserve the tempo and recognizable motifs. When the distribution changes substantially, make one clearly audible, coherent transition; small shifts need only a subtle adjustment.',
		'Energy: mellow means sparse percussion and softer bass; balanced means a steady dance groove; intense means a firm kick, driving bass and open hats, with gain headroom. Rhythm: steady means a simple pulse; flowing means syncopation; busy means denser percussion with rests. Mood: dark means minor harmony and muted timbre; warm means rounded bass and soft chords; bright means a higher hook and open filters. Blend the whole distribution.',
		'Bass movement: deep means long low pulses with rests; bouncy means short syncopated notes; rolling means a repeating flowing bass figure. Melody: minimal means fewer hook notes; hook means preserve and repeat the recognizable motif; playful means vary that motif instead of stacking new melodies. Texture: smooth means rounded filtered tones; gritty means controlled saturation with headroom; sharp means short bright attacks. Space: dry means little reverb or delay; echo means rhythmic delay; spacious means longer tails and sparse notes. These dimensions are independent: more space or grit must not automatically increase note density or energy.',
		'Remove any music-vote performance comment and all() performance transformation before composing the next crowd update. Do not change tempo or add all()/each() transforms.',
		'If the groove already fits this mix, return exactly HOLD. Otherwise return the complete updated Strudel pattern.',
		fewShotsBlock(),
		soundsBlock(),
		'Output only HOLD or strudel.js code, no prose or markdown fences.',
	].join('\n')
}
