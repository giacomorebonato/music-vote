import { expect, test } from 'bun:test'
import { signInSchema, signUpSchema } from '@shared/schemas/auth'

test('signInSchema accepts a valid email and password', () => {
	const result = signInSchema.safeParse({
		email: 'user@example.com',
		password: 'password123',
	})
	expect(result.success).toBe(true)
})

test('signInSchema rejects an invalid email', () => {
	const result = signInSchema.safeParse({
		email: 'not-an-email',
		password: 'password123',
	})
	expect(result.success).toBe(false)
})

test('signInSchema rejects a short password', () => {
	const result = signInSchema.safeParse({
		email: 'user@example.com',
		password: 'short',
	})
	expect(result.success).toBe(false)
})

test('signInSchema does not require a name', () => {
	const result = signInSchema.safeParse({
		email: 'user@example.com',
		password: 'password123',
	})
	expect(result.success).toBe(true)
})

test('signUpSchema accepts a valid signup', () => {
	const result = signUpSchema.safeParse({
		email: 'user@example.com',
		password: 'password123',
		name: 'Jane',
	})
	expect(result.success).toBe(true)
})

test('signUpSchema rejects an invalid email', () => {
	const result = signUpSchema.safeParse({
		email: 'nope',
		password: 'password123',
		name: 'Jane',
	})
	expect(result.success).toBe(false)
})

test('signUpSchema rejects a short password', () => {
	const result = signUpSchema.safeParse({
		email: 'user@example.com',
		password: 'pw',
		name: 'Jane',
	})
	expect(result.success).toBe(false)
})

test('signUpSchema rejects a missing name', () => {
	const result = signUpSchema.safeParse({
		email: 'user@example.com',
		password: 'password123',
		name: '',
	})
	expect(result.success).toBe(false)
})
