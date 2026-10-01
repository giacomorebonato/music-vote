export const TRPC_ENDPOINT = '/api/trpc'

/**
 * tRPC's fetch adapter expects the procedure path encoded with dots
 * (`/api/trpc/notes.list`). Some callers/links send slash-separated paths
 * (`/api/trpc/notes/list`). Normalize slash-separated paths back to dots so
 * the adapter routes them. The bare endpoint (`/api/trpc` with no trailing
 * path, used by batch links that pass procedures via query/body) is passed
 * through unchanged.
 */
export function normalizeTrpcRequest(req: Request, url: URL): Request {
	const afterEndpoint = url.pathname.slice(TRPC_ENDPOINT.length)
	if (!afterEndpoint.includes('/')) {
		return req
	}
	const normalizedPath = afterEndpoint
		.replace(/\//g, '.')
		.replace(/^\.+|\.+$/g, '')
	const newUrl = new URL(
		`${TRPC_ENDPOINT}${normalizedPath ? `/${normalizedPath}` : ''}${url.search}`,
		url.origin,
	)
	return new Request(newUrl, req)
}
