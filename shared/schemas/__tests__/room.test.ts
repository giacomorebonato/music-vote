import { expect, test } from 'bun:test'
import { createRoomSchema, steerSchema } from '../room'

const base = {
	bpm: 120,
	lengthMin: 10,
	genre: 'techno',
}

test('pollIntervalSec accepts 5s minimum', () => {
	expect(
		createRoomSchema.safeParse({ ...base, pollIntervalSec: 5, pollOpenSec: 60 })
			.success,
	).toBe(true)
	expect(
		createRoomSchema.safeParse({
			...base,
			pollIntervalSec: 600,
			pollOpenSec: 60,
		}).success,
	).toBe(true)
})

test('pollIntervalSec rejects below 5s and above 600s', () => {
	expect(
		createRoomSchema.safeParse({ ...base, pollIntervalSec: 4, pollOpenSec: 60 })
			.success,
	).toBe(false)
	expect(
		createRoomSchema.safeParse({
			...base,
			pollIntervalSec: 601,
			pollOpenSec: 60,
		}).success,
	).toBe(false)
})

test('pollOpenSec accepts 15s minimum and 600s maximum', () => {
	expect(
		createRoomSchema.safeParse({
			...base,
			pollOpenSec: 15,
			pollIntervalSec: 60,
		}).success,
	).toBe(true)
	expect(
		createRoomSchema.safeParse({
			...base,
			pollOpenSec: 600,
			pollIntervalSec: 60,
		}).success,
	).toBe(true)
})

test('steerSchema accepts a trimmed host note', () => {
	const result = steerSchema.safeParse({
		roomId: 'r1',
		text: '  bring the drums forward  ',
	})
	expect(result.success).toBe(true)
	if (result.success) expect(result.data.text).toBe('bring the drums forward')
})

test('steerSchema rejects notes that trim short or exceed 200 chars', () => {
	expect(steerSchema.safeParse({ roomId: 'r1', text: '  ab  ' }).success).toBe(
		false,
	)
	expect(
		steerSchema.safeParse({ roomId: 'r1', text: `x${'x'.repeat(200)}` })
			.success,
	).toBe(false)
})

test('pollOpenSec rejects below 15s and above 600s', () => {
	expect(
		createRoomSchema.safeParse({
			...base,
			pollOpenSec: 14,
			pollIntervalSec: 60,
		}).success,
	).toBe(false)
	expect(
		createRoomSchema.safeParse({
			...base,
			pollOpenSec: 601,
			pollIntervalSec: 60,
		}).success,
	).toBe(false)
})
