import { expect, test } from 'bun:test'
import {
	normalizeTrpcRequest,
	TRPC_ENDPOINT,
} from '@backend/normalize-trpc-request'

function call(
	pathnameAndSearch: string,
	init?: RequestInit,
): { req: Request; result: Request } {
	const req = new Request(`http://localhost${pathnameAndSearch}`, init)
	const url = new URL(req.url)
	return { req, result: normalizeTrpcRequest(req, url) }
}

test('passes the bare endpoint through unchanged', () => {
	const { req, result } = call(TRPC_ENDPOINT)
	expect(result).toBe(req)
})

test('passes the bare endpoint with a query through unchanged', () => {
	const { req, result } = call(`${TRPC_ENDPOINT}?batch=1`)
	expect(result).toBe(req)
})

test('normalizes a slash-separated procedure path to dots', () => {
	const { result } = call('/api/trpc/notes/list')
	expect(new URL(result.url).pathname).toBe('/api/trpc/notes.list')
})

test('is idempotent on already dot-separated paths', () => {
	const { result } = call('/api/trpc/notes.list')
	expect(new URL(result.url).pathname).toBe('/api/trpc/notes.list')
})

test('preserves the query string', () => {
	const { result } = call('/api/trpc/notes/list?batch=1&input=%7B%7D')
	expect(new URL(result.url).search).toBe('?batch=1&input=%7B%7D')
})

test('normalizes a nested procedure path', () => {
	const { result } = call('/api/trpc/users/posts/list')
	expect(new URL(result.url).pathname).toBe('/api/trpc/users.posts.list')
})

test('preserves the request method and headers', () => {
	const { result } = call('/api/trpc/notes/list', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
	})
	expect(result.method).toBe('POST')
	expect(result.headers.get('content-type')).toBe('application/json')
})
