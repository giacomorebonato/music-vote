import { expect, test } from 'bun:test'
import { createRoomSchema } from '../room'

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
