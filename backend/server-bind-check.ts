// Boot-time loopback ownership check.
//
// Bun.serve sets SO_REUSEADDR, which on macOS lets our wildcard bind coexist
// silently with another process holding 127.0.0.1 on the same port. Browsers
// resolving `localhost` then intermittently land on the wrong app (seen live:
// another dev server squatting 127.0.0.1:3000 while music-vote printed its
// banner on the same port). server.ts binds 0.0.0.0 and runs these probes
// right after Bun.serve:
//
// - expectOwnsLoopback: a POST to our own tRPC endpoint over 127.0.0.1 must
//   come back as this server's JSON. A foreign squatter answers HTML/text
//   instead and the server refuses to run. Heuristic limit: the check is the
//   JSON content type only, so a foreign server that happened to answer the
//   probe with JSON would pass — the common squatter (another dev app's HTML
//   login page) does not.
// - expectIpv6LoopbackRefused: the server holds no IPv6 socket, so browsers
//   resolving `localhost` to ::1 must be refused there. Anything answering
//   on [::1] is a foreign process hijacking the loopback name, and the server
//   refuses to run.

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

export async function expectIpv6LoopbackRefused(
	port: number,
	probePath: string,
): Promise<void> {
	const target = `http://[::1]:${port}${probePath}`
	try {
		const response = await fetch(target, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		})
		throw new Error(
			`Port ${port} conflict: another process is answering on [::1]:${port} (probe ${probePath} got ${response.status}). Stop it or set PORT.`,
		)
	} catch (cause) {
		if (
			cause instanceof Error &&
			/another process is answering/.test(cause.message)
		) {
			throw cause
		}
		// This server holds no IPv6 socket, so loopback ::1 must be refused when
		// nobody else took it. Only a refused/reset connection counts as free;
		// a timeout means something accepted the connection without answering.
		const message = cause instanceof Error ? cause.message : String(cause)
		if (!/ECONNREFUSED|Connection refused|Connection reset/i.test(message)) {
			throw new Error(
				`Server bind check failed: probe ${target} was neither refused nor answered (${message}); expected [::1] to be free because this server binds IPv4 only. Stop whatever holds [::1]:${port} or set PORT.`,
				{ cause },
			)
		}
	}
}
