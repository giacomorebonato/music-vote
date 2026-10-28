import { z } from 'zod'

/** Stable targets, rather than repeated requests for "more" of something. */
export const preferenceQuestions = [
	{
		key: 'energy',
		question: 'What energy feels right?',
		options: [
			{ key: 'mellow', label: 'Mellow' },
			{ key: 'balanced', label: 'Balanced' },
			{ key: 'intense', label: 'Intense' },
		],
	},
	{
		key: 'rhythm',
		question: 'What rhythm feels right?',
		options: [
			{ key: 'steady', label: 'Steady' },
			{ key: 'flowing', label: 'Flowing' },
			{ key: 'busy', label: 'Busy' },
		],
	},
	{
		key: 'mood',
		question: 'What mood feels right?',
		options: [
			{ key: 'dark', label: 'Dark' },
			{ key: 'warm', label: 'Warm' },
			{ key: 'bright', label: 'Bright' },
		],
	},
	{
		key: 'bass',
		question: 'How should the bass move?',
		options: [
			{ key: 'deep', label: 'Deep pulses' },
			{ key: 'bouncy', label: 'Bouncy' },
			{ key: 'rolling', label: 'Rolling' },
		],
	},
	{
		key: 'melody',
		question: 'What should the melody do?',
		options: [
			{ key: 'minimal', label: 'Minimal' },
			{ key: 'hook', label: 'Repeat the hook' },
			{ key: 'playful', label: 'Playful' },
		],
	},
	{
		key: 'texture',
		question: 'Give the synth a character',
		options: [
			{ key: 'smooth', label: 'Smooth' },
			{ key: 'gritty', label: 'Gritty' },
			{ key: 'sharp', label: 'Sharp' },
		],
	},
	{
		key: 'space',
		question: 'Where should the sound live?',
		options: [
			{ key: 'dry', label: 'Close and dry' },
			{ key: 'echo', label: 'Echoing' },
			{ key: 'spacious', label: 'Spacious' },
		],
	},
]

export const preferenceAnswerSchema = z.object({
	pollId: z.string().min(1),
	choice: z.string().min(1).nullable(),
})

const crowdQuestionSchema = z.object({
	id: z.string(),
	question: z.string(),
	options: z.array(z.object({ key: z.string(), label: z.string() })),
	counts: z.record(z.string(), z.number().int().nonnegative()),
})

export const crowdSnapshotSchema = z.array(crowdQuestionSchema)
export type CrowdSnapshot = z.infer<typeof crowdSnapshotSchema>
export type CrowdQuestion = CrowdSnapshot[number] & { choice: string | null }
