/**
 * Bun's dev server (HTMLBundle routes + /_bun/* + the HMR socket) answers
 * `403 Blocked: Host header does not match the dev server` to any Host that
 * is not localhost, `*.localhost` or an IP literal (DNS-rebinding guard; no
 * allowedHosts option on Bun 1.4 — upstream PR oven-sh/bun#47359 pending).
 *
 * Tailscale serve forwards the tailnet hostname, so under `bun run dev:net`
 * the SPA shell would be unreachable for tailnet clients while the /api
 * function routes keep working. Disabling the dev server serves the bundled
 * SPA to everyone; HMR stays available through plain `bun run dev`, whose
 * `.localhost` Host the guard accepts.
 */
export function resolveDevelopmentMode(
	env: NodeJS.ProcessEnv = process.env,
): boolean | { hmr: boolean; console: boolean } {
	const sharingOverTailscale = Boolean(env.PORTLESS_TAILSCALE_URL?.trim())
	return sharingOverTailscale ? false : { hmr: true, console: true }
}
