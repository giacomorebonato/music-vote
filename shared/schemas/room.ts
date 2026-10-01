import { z } from 'zod'

export const createRoomSchema = z.object({
	bpm: z.int().min(60).max(200),
	lengthMin: z.int().min(5).max(60),
	pollIntervalSec: z.int().min(60).max(600),
	genre: z.string().min(1).max(80),
})
