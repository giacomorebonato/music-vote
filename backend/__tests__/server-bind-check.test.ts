import { afterEach, beforeEach, expect, test } from 'bun:test'
import { expectOwnsLoopback } from '@backend/server-bind-check'

const originalFetch = globalThis.fetch

beforeEach(() => {
	delete process.env.PORT
})

afterEach(() => {
	globalThis.fetch = originalFetch
	delete process.env.PORT
})

test('resolves when the loopback probe answers as this server (tRPC JSON)', async () => {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ error: 'No procedure found' }), {
			status: 404,
			headers: { 'content-type': 'application/json' },
		})) as unknown as typeof fetch

	await expect(expectOwnsLoopback(3000, '/api/trpc')).resolves.toBeUndefined()
})

test('throws a port-conflict error when a foreign process answers with HTML', async () => {
	globalThis.fetch = (async () =>
		new Response('<html>another app</html>', {
			status: 200,
			headers: { 'content-type': 'text/html' },
		})) as unknown as typeof fetch

	await expect(expectOwnsLoopback(3000, '/api/trpc')).rejects.toThrow(
		/another process is answering/,
	)
})

test('throws a port-conflict error when a foreign process answers with no JSON content type', async () => {
	globalThis.fetch = (async () =>
		new Response('Unauthorized', {
			status: 401,
			headers: { 'content-type': 'text/plain' },
		})) as unknown as typeof fetch

	await expect(expectOwnsLoopback(3000, '/api/trpc')).rejects.toThrow(
		/another process is answering/,
	)
})

test('probes with a JSON content type so tRPC answers JSON, not 415 text/plain', async () => {
	const calls: { init?: RequestInit }[] = []
	globalThis.fetch = (async (
		_input: string | URL | Request,
		init?: RequestInit,
	) => {
		calls.push({ init })
		return new Response(JSON.stringify({ error: 'No procedure found' }), {
			status: 404,
			headers: { 'content-type': 'application/json' },
		})
	}) as unknown as typeof fetch

	await expectOwnsLoopback(3000, '/api/trpc/health')
	const headers = new Headers(calls[0]?.init?.headers)
	expect(headers.get('content-type')).toBe('application/json')
})

test('rethrows probe transport failures with the loopback target named', async () => {
	globalThis.fetch = (async () => {
		throw new Error('ECONNREFUSED')
	}) as unknown as typeof fetch

	await expect(expectOwnsLoopback(3000, '/api/trpc')).rejects.toThrow(
		/127\.0\.0\.1:3000.*ECONNREFUSED/s,
	)
})
