// Boot-time loopback ownership check.
//
// Bun.serve sets SO_REUSEADDR, which on macOS lets our wildcard bind coexist
// silently with another process holding 127.0.0.1 on the same port. Browsers
// resolving `localhost` then intermittently land on the wrong app (seen live:
// another dev server squatting 127.0.0.1:3000 while music-vote printed its
// banner on the same port). server.ts binds 0.0.0.0 and runs this probe right
// after Bun.serve: a POST to our own tRPC endpoint over 127.0.0.1 must come
// back as this server's JSON. A foreign squatter answers HTML/text instead
// (or, for exact-address binds, the kernel routes loopback to it) and the
// server refuses to run, telling the host to free the port or pick another.

const PROBE_TIMEOUT_MS = 2_000

export async function expectOwnsLoopback(
	port: number,
	probePath: string,
): Promise<void> {
	const target = `http://127.0.0.1:${port}${probePath}`
	let response: Response
	try {
		response = await fetch(target, {
			method: 'POST',
			// JSON content type: with the fetch default (text/plain) tRPC rejects
			// the probe with a 415 text/plain response and the check would report
			// its own server as a squatter.
			headers: { 'content-type': 'application/json' },
			body: '{}',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		})
	} catch (cause) {
		throw new Error(
			`Server bind check failed: probe ${target} did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		)
	}
	const contentType = response.headers.get('content-type') ?? ''
	if (!contentType.includes('json')) {
		throw new Error(
			`Port ${port} conflict: another process is answering on 127.0.0.1:${port} (probe ${probePath} got ${response.status} ${contentType || 'no content-type'}). Stop it or set PORT.`,
		)
	}
}
