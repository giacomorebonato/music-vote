import { z } from 'zod'

export const performanceActionSchema = z.object({
	roomId: z.string().min(1),
	action: z.enum(['build', 'drop', 'strip']),
})

// A one-shot host steering note: consumed by the next delivered update; the
// raw text never persists server-side.
export const steerSchema = z.object({
	roomId: z.string().min(1),
	text: z.string().trim().min(3).max(200),
})

export const grooveLockSchema = z.object({
	roomId: z.string().min(1),
	locked: z.boolean(),
})

export const createRoomSchema = z.object({
	bpm: z.int().min(60).max(200),
	lengthMin: z.int().min(5).max(60),
	pollIntervalSec: z.int().min(5).max(600),
	pollOpenSec: z.int().min(15).max(600),
	genre: z.string().min(1).max(80),
})
