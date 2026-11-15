import { describe, expect, test } from 'bun:test'
import { resolveAuthBaseURL, resolveAuthTrustedOrigins } from '../base-url'

describe('resolveAuthBaseURL', () => {
	test('prefers the portless tailscale URL when all are set', () => {
		expect(
			resolveAuthBaseURL({
				PORTLESS_TAILSCALE_URL: 'https://node.tailnet.ts.net',
				PORTLESS_URL: 'https://branch.music-vote.localhost',
				BETTER_AUTH_URL: 'http://localhost:3000',
			}),
		).toBe('https://node.tailnet.ts.net')
	})

	test('falls back to the portless URL without tailscale', () => {
		expect(
			resolveAuthBaseURL({
				PORTLESS_URL: 'https://branch.music-vote.localhost',
				BETTER_AUTH_URL: 'http://localhost:3000',
			}),
		).toBe('https://branch.music-vote.localhost')
	})

	test('uses BETTER_AUTH_URL when no portless env is set', () => {
		expect(resolveAuthBaseURL({ BETTER_AUTH_URL: 'https://example.com' })).toBe(
			'https://example.com',
		)
	})

	test('defaults to localhost when nothing is set', () => {
		expect(resolveAuthBaseURL({})).toBe('http://localhost:3000')
	})

	test('treats empty strings as unset', () => {
		expect(
			resolveAuthBaseURL({
				PORTLESS_TAILSCALE_URL: '',
				PORTLESS_URL: '',
				BETTER_AUTH_URL: 'https://example.com',
			}),
		).toBe('https://example.com')
		expect(
			resolveAuthBaseURL({
				PORTLESS_TAILSCALE_URL: '',
				PORTLESS_URL: '',
				BETTER_AUTH_URL: '',
			}),
		).toBe('http://localhost:3000')
	})
})

describe('resolveAuthTrustedOrigins', () => {
	test('trusts the portless URL origin', () => {
		expect(
			resolveAuthTrustedOrigins({
				PORTLESS_URL: 'https://branch.music-vote.localhost',
			}),
		).toEqual(['https://branch.music-vote.localhost'])
	})

	test('returns no origins without a portless URL', () => {
		expect(resolveAuthTrustedOrigins({})).toEqual([])
	})

	test('ignores an empty portless URL', () => {
		expect(resolveAuthTrustedOrigins({ PORTLESS_URL: '' })).toEqual([])
	})
})
