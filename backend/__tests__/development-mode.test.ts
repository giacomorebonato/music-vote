import { describe, expect, test } from 'bun:test'
import { resolveDevelopmentMode } from '../development-mode'

describe('resolveDevelopmentMode', () => {
	test('keeps HMR and console for plain dev', () => {
		expect(resolveDevelopmentMode({})).toEqual({ hmr: true, console: true })
	})

	test('keeps HMR and console under plain portless (.localhost Host is allowed)', () => {
		expect(
			resolveDevelopmentMode({
				PORTLESS_URL: 'http://branch.music-vote.localhost',
			}),
		).toEqual({ hmr: true, console: true })
	})

	test('disables the dev server when sharing over tailscale', () => {
		expect(
			resolveDevelopmentMode({
				PORTLESS_TAILSCALE_URL: 'https://node.tailnet.ts.net',
			}),
		).toBe(false)
	})

	test('treats an empty tailscale URL as unset', () => {
		expect(resolveDevelopmentMode({ PORTLESS_TAILSCALE_URL: '' })).toEqual({
			hmr: true,
			console: true,
		})
	})
})
