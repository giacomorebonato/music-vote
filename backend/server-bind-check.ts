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
//   refuses to run. Bun's fetch wraps connect failures in version- and
//   platform-drifting text (1.4.2 on Linux has no errno token; 1.4.4+/canary
//   prefix it), so only an answered probe or a timeout after an accepted
//   connection means [::1] is occupied; every other connect failure means it
//   is free - including unreachable (no v6 loopback, nothing can squat it).

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
		// Bun's fetch wraps connect failures in version- and platform-drifting
		// text (1.4.2 on Linux wraps a refused [::1] connect as a bare TypeError
		// with no errno token; 1.4.4+/canary prefix errno tokens), so a refusal
		// cannot be detected by message. Only the two occupied outcomes are
		// classified: answered (rethrown above) or accepted-but-silent
		// (AbortSignal.timeout fires). Every other connect failure resolves as
		// free - including unreachable, since without a v6 loopback nothing can
		// squat [::1].
		const message = cause instanceof Error ? cause.message : String(cause)
		if (
			(cause instanceof Error && cause.name === 'TimeoutError') ||
			/timed out/i.test(message)
		) {
			throw new Error(
				`Port ${port} conflict: another process accepted the connection on [::1]:${port} without answering (probe ${probePath} timed out). Stop it or set PORT.`,
				{ cause },
			)
		}
	}
}
