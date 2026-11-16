import { afterEach, expect, test } from 'bun:test'
import {
	expectIpv6LoopbackRefused,
	expectOwnsLoopback,
} from '@backend/server-bind-check'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
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

test('IPv6 loopback probe passes when nothing answers (we hold no IPv6 socket)', async () => {
	globalThis.fetch = (async () => {
		throw new Error('ECONNREFUSED')
	}) as unknown as typeof fetch

	await expect(
		expectIpv6LoopbackRefused(3000, '/api/trpc/boot-probe'),
	).resolves.toBeUndefined()
})

test('IPv6 loopback probe throws a conflict error when any process answers on [::1]', async () => {
	globalThis.fetch = (async () =>
		new Response('<html>squatter</html>', {
			status: 200,
			headers: { 'content-type': 'text/html' },
		})) as unknown as typeof fetch

	await expect(
		expectIpv6LoopbackRefused(3000, '/api/trpc/boot-probe'),
	).rejects.toThrow(/another process is answering on \[::1\]/)
})

test('IPv6 loopback probe refuses when the connection is accepted but never answers', async () => {
	globalThis.fetch = (async () => {
		throw new Error('The operation timed out.')
	}) as unknown as typeof fetch

	await expect(
		expectIpv6LoopbackRefused(3000, '/api/trpc/boot-probe'),
	).rejects.toThrow(/accepted the connection .* without answering/)
})

test('IPv6 loopback probe passes when Bun wraps the refusal without an errno', async () => {
	// Bun 1.4.2 on Linux wraps a refused connect as a bare TypeError with no
	// ECONNREFUSED token — seen live on the Fly machine (prod crash loop).
	globalThis.fetch = (async () => {
		throw new TypeError(
			'Unable to connect. Is the computer able to access the url?',
		)
	}) as unknown as typeof fetch

	await expect(
		expectIpv6LoopbackRefused(3000, '/api/trpc/boot-probe'),
	).resolves.toBeUndefined()
})

test('IPv6 loopback probe still conflicts on TimeoutError name from AbortSignal.timeout', async () => {
	globalThis.fetch = (async () => {
		const e = new Error('The operation timed out.')
		e.name = 'TimeoutError'
		throw e
	}) as unknown as typeof fetch

	await expect(
		expectIpv6LoopbackRefused(3000, '/api/trpc/boot-probe'),
	).rejects.toThrow(/accepted the connection .* without answering/)
})
