import { expect, test } from '@playwright/test'

const BOT_UA =
	'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const BROWSER_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

test('bot gets rendered HTML; browser gets the raw SPA shell', async ({
	request,
}) => {
	// Bot → lightpanda renders the SPA, tagline is in the DOM.
	const bot = await request.get('/', { headers: { 'user-agent': BOT_UA } })
	expect(bot.headers()['content-type'] ?? '').toContain('text/html')
	const botBody = await bot.text()
	expect(botBody).toContain('Crowd-voted AI live music.')

	// Browser → raw SPA shell, #root empty, no rendered content.
	const browser = await request.get('/', {
		headers: { 'user-agent': BROWSER_UA },
	})
	const browserBody = await browser.text()
	expect(browserBody).toContain('<div id="root"></div>')
	expect(browserBody).not.toContain('Crowd-voted AI live music.')
})
