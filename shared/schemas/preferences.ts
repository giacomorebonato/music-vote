import { z } from 'zod'

/** Stable targets, rather than repeated requests for "more" of something. */
export const preferenceQuestions = [
	{
		question: 'What energy feels right?',
		options: [
			{ key: 'mellow', label: 'Mellow' },
			{ key: 'balanced', label: 'Balanced' },
			{ key: 'intense', label: 'Intense' },
		],
	},
	{
		question: 'What rhythm feels right?',
		options: [
			{ key: 'steady', label: 'Steady' },
			{ key: 'flowing', label: 'Flowing' },
			{ key: 'busy', label: 'Busy' },
		],
	},
	{
		question: 'What mood feels right?',
		options: [
			{ key: 'dark', label: 'Dark' },
			{ key: 'warm', label: 'Warm' },
			{ key: 'bright', label: 'Bright' },
		],
	},
]

export const preferenceAnswerSchema = z.object({
	pollId: z.string().min(1),
	choice: z.string().min(1),
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
