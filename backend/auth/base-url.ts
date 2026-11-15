const firstNonEmpty = (...values: Array<string | undefined>) =>
	values.find((value) => value !== undefined && value !== '')

const DEFAULT_BASE_URL = 'http://localhost:3000'

/**
 * Resolve better-auth's baseURL for the URL the app is actually served on.
 *
 * Under `bun run dev:net` portless hands the child process
 * `PORTLESS_TAILSCALE_URL` (tailnet-shared) and `PORTLESS_URL`
 * (branch-prefixed .localhost URL), and the server listens on an ephemeral
 * `PORT` — so a `.env` `BETTER_AUTH_URL` pointing at localhost:3000 is wrong.
 * Portless URLs win; without portless the legacy behavior is unchanged.
 * Empty strings count as unset.
 */
export function resolveAuthBaseURL(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return (
		firstNonEmpty(
			env.PORTLESS_TAILSCALE_URL,
			env.PORTLESS_URL,
			env.BETTER_AUTH_URL,
		) ?? DEFAULT_BASE_URL
	)
}

/**
 * While phones use the ts.net URL, the host browser may use the .localhost
 * origin; trust it so better-auth's origin check does not 403 auth POSTs.
 */
export function resolveAuthTrustedOrigins(
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const portlessUrl = firstNonEmpty(env.PORTLESS_URL)
	return portlessUrl ? [portlessUrl] : []
}
