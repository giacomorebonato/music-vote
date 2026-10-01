import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	isMainThread,
	parentPort,
	Worker,
	workerData,
} from 'node:worker_threads'

// Resolve the lightpanda binary the same way @lightpanda/browser does:
// LIGHTPANDA_EXECUTABLE_PATH wins, else ~/.cache/lightpanda-node/lightpanda.
function lightpandaBinary(): string {
	return (
		process.env.LIGHTPANDA_EXECUTABLE_PATH ??
		resolvePath(`${homedir()}/.cache/lightpanda-node/lightpanda`)
	)
}

export async function requestFromBrowser(url: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const worker = new Worker(fileURLToPath(import.meta.url), {
			workerData: { url },
		})
		worker.on('message', (m) => {
			resolve(m as string)
			worker.terminate().catch(() => {})
		})
		worker.on('error', (e) => {
			reject(e)
			worker.terminate().catch(() => {})
		})
	})
}

if (!isMainThread) {
	// We spawn the lightpanda CLI directly instead of using @lightpanda/browser's
	// JS `fetch` helper. The helper (1.3.2) only passes `--dump html` and does not
	// expose `--wait-until`, so the binary uses its default `load` event — which
	// fires before the SPA's async tRPC queries resolve, producing a render with
	// "Loading…" instead of the real content. `networkidle` waits for in-flight
	// XHR/fetch (the siteInfo query) to settle, so the dumped DOM contains the
	// rendered tagline. The CLI's own User-Agent ("Lightpanda/...") is what the
	// prerender handler matches to break the render-recursion loop.
	void (async (): Promise<void> => {
		const html = execFileSync(
			lightpandaBinary(),
			[
				'fetch',
				workerData.url as string,
				'--dump',
				'html',
				'--wait-until',
				'networkidle',
			],
			{ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
		)
		parentPort?.postMessage(html)
	})()
}
