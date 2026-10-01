import Crypto from 'node:crypto'
import Fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requestFromBrowser } from '@backend/ssr/request-from-browser'
import { isbot } from 'isbot'

export type PrerenderOptions = {
	urls: (string | RegExp)[]
	host?: string
	port: number
	cacheDir?: string
}

const CACHE_TTL_MINUTES = 5

// Minimal pathname-key sanitizer (inlined to avoid an extra dependency).
function sanitizePathname(pathname: string): string {
	const stripped = pathname.replace(/\//g, '_').replace(/[^a-zA-Z0-9._-]/g, '')
	return stripped || 'index'
}

function isRequestFromBot(userAgent: string): boolean {
	const ua = userAgent
	const lower = ua.toLowerCase()
	return (
		isbot(ua) ||
		lower.startsWith('facebookexternalhit') ||
		lower.startsWith('whatsapp') ||
		lower.startsWith('twitterbot')
	)
}

function matchesAllowlist(
	requestUrl: string,
	requestPathname: string,
	urls: (string | RegExp)[],
): boolean {
	for (const url of urls) {
		if (typeof url === 'string') {
			if (url === requestPathname) return true
		} else if (url.test(requestUrl)) {
			return true
		}
	}
	return false
}

export function createPrerenderHandler(opts: PrerenderOptions): {
	handle: (req: Request) => Promise<Response | null>
} {
	const cacheDir =
		opts.cacheDir ?? Fs.mkdtempSync(join(tmpdir(), 'mino-prerender-'))
	Fs.mkdirSync(cacheDir, { recursive: true })

	const origin = `http://${opts.host ?? 'localhost'}:${opts.port}`

	// Returns a rendered Response, or null to let the request fall through.
	async function handle(req: Request): Promise<Response | null> {
		if (req.method !== 'GET') return null
		const userAgent = req.headers.get('user-agent') ?? ''

		// Lightpanda's own requests self-identify → break the recursion.
		if (userAgent.startsWith('Lightpanda/')) return null
		if (!isRequestFromBot(userAgent)) return null

		const parsed = new URL(req.url)
		const pathAndQuery = `${parsed.pathname}${parsed.search}`
		// Match pathname for strings, path+query for regex (Bun's req.url is absolute).
		if (!matchesAllowlist(pathAndQuery, parsed.pathname, opts.urls)) return null

		const renderUrl = `${origin}${pathAndQuery}`
		const cached = getCachedResponse(cacheDir, renderUrl)
		if (cached) return cached

		const html = (await requestFromBrowser(renderUrl).catch(() => '')) ?? ''
		// Empty render (failure/timeout) → don't poison the cache; fall through to
		// the raw SPA shell so the bot still gets valid HTML instead of a blank page.
		if (!html) return null

		setCachedResponse(cacheDir, renderUrl, html)

		return new Response(html, {
			headers: { 'content-type': 'text/html; charset=utf-8' },
		})
	}

	return { handle }
}

function cacheKeyForUrl(url: string): { filename: string } {
	const urlObj = new URL(url)
	const pathname = sanitizePathname(urlObj.pathname)
	const queryString = urlObj.search
	let filename = pathname
	if (queryString) {
		const queryHash = Crypto.createHash('md5').update(queryString).digest('hex')
		filename = `${filename}_${queryHash}`
	}
	filename = `${filename}.html`
	return { filename }
}

function getCachedResponse(cacheDir: string, url: string): Response | null {
	const { filename } = cacheKeyForUrl(url)
	const filepath = join(cacheDir, filename)

	if (!Fs.existsSync(filepath)) return null
	const fileStat = Fs.statSync(filepath)
	const fileAgeMinutes = (Date.now() - fileStat.mtime.getTime()) / 1_000 / 60
	if (fileAgeMinutes <= CACHE_TTL_MINUTES) {
		return new Response(Fs.readFileSync(filepath), {
			headers: { 'content-type': 'text/html; charset=utf-8' },
		})
	}
	Fs.rmSync(filepath)
	return null
}

function setCachedResponse(cacheDir: string, url: string, html: string): void {
	const { filename } = cacheKeyForUrl(url)
	const filepath = join(cacheDir, filename)
	try {
		Fs.writeFileSync(filepath, html)
	} catch {
		// cache write failure is non-fatal
	}
}
