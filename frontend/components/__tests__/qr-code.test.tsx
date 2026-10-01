import { expect, test } from 'bun:test'
import { QrCode, qrDataUrl } from '@frontend/components/qr-code'
import { renderToStaticMarkup } from 'react-dom/server'

const VOTE_URL = 'http://localhost:3000/r/room-123'

test('qrDataUrl encodes a vote URL as a PNG data URL', async () => {
	const dataUrl = await qrDataUrl(VOTE_URL)
	expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
})

test('QrCode renders an img whose src is the PNG data URL', async () => {
	// The component reads its memoized data URL synchronously on the first
	// render; priming here exercises the same cache path a mounted page uses.
	await qrDataUrl(VOTE_URL)
	const markup = renderToStaticMarkup(<QrCode value={VOTE_URL} />)
	expect(markup).toContain('<img')
	expect(markup).toContain('src="data:image/png')
})
