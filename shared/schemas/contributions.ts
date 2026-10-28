import { z } from 'zod'
import { preferenceQuestions } from '@shared/schemas/preferences'

export const sampleUseSchema = z.enum(['percussion', 'hook', 'atmosphere'])
export const momentActionSchema = z.enum(['build', 'drop', 'strip'])
export const directionTextSchema = z.string().trim().min(1).max(240)
export const musicalIntentSchema = z
	.object({
		kind: z.enum(['preference', 'moment', 'unsupported']),
		targets: z
			.array(z.object({ dimension: z.string(), choice: z.string() }))
			.max(7),
		action: momentActionSchema.optional(),
	})
	.superRefine((intent, ctx) => {
		const dimensions = new Set<string>()
		for (const target of intent.targets) {
			const definition = preferenceQuestions.find(
				(q) => q.key === target.dimension,
			)
			if (
				!definition?.options.some((o) => o.key === target.choice) ||
				dimensions.has(target.dimension)
			)
				ctx.addIssue({
					code: 'custom',
					message: 'Invalid or repeated musical dimension',
				})
			dimensions.add(target.dimension)
		}
		if (intent.kind === 'preference' && !intent.targets.length)
			ctx.addIssue({
				code: 'custom',
				message: 'A direction needs musical targets',
			})
		if (intent.kind === 'moment' && !intent.action)
			ctx.addIssue({ code: 'custom', message: 'A moment needs an action' })
	})
export type MusicalIntent = z.infer<typeof musicalIntentSchema>

export const contributionContextSchema = z.object({
	directions: z.array(
		z.object({
			id: z.string(),
			revision: z.number().int(),
			intent: musicalIntentSchema,
		}),
	),
	recordingId: z.string().optional(),
	momentId: z.string().optional(),
	momentAction: momentActionSchema.optional(),
})
export type ContributionContext = z.infer<typeof contributionContextSchema>

export const samplePlaybackSchema = z.object({
	id: z.string(),
	url: z.string(),
	use: sampleUseSchema,
	bpm: z.number(),
	expiresAt: z.number().optional(),
})
export type SamplePlayback = z.infer<typeof samplePlaybackSchema>

export function describeIntent(intent: MusicalIntent): string {
	if (intent.kind === 'unsupported')
		return 'This request cannot be made with the current sounds.'
	if (intent.kind === 'moment')
		return {
			build: 'Build tension',
			drop: 'Bring the drop',
			strip: 'Strip back',
		}[intent.action ?? 'build']
	return intent.targets
		.map((t) => {
			const q = preferenceQuestions.find((q) => q.key === t.dimension)
			return `${t.dimension}: ${q?.options.find((o) => o.key === t.choice)?.label ?? t.choice}`
		})
		.join(' · ')
}
