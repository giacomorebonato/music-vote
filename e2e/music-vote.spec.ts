import { readFileSync } from 'node:fs'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

/**
 * Full democratic cycle, end to end: host signs up → creates a room → starts
 * it → the host browser is the audio engine (QR + playing music) → anonymous
 * phones vote the live poll → the winning option drives a mocked LLM evolution
 * the host applies → the host undoes it → the host ends the set → the audience
 * reads the summary timeline.
 *
 * Timing comes entirely from the shipped `MV_E2E_FAST=1` hook (see
 * `backend/polls/scheduler.ts`): the poll open window shrinks to 5s. The room
 * interval still bottoms out at the schema minimum (5s; the room is created
 * with a generous 60s interval below for realism), so a full cycle takes a bit
 * over two interval ticks plus the outro window; the per-file timeout below is
 * sized for that, not padded.
 */

// The server reads this same file via `LLM_MOCK_SCRIPT` (playwright.config.ts).
// Reading it here keeps the spec's expected strings from drifting from the
// scripted responses.
const llmScript = JSON.parse(
	readFileSync(new URL('./fixtures/llm-script.json', import.meta.url), 'utf8'),
) as { responses: string[] }

// `MockLlmProvider` is constructed fresh by every `getLlmProvider()` call, and
// each construction re-reads the file from index 0. `startRoom` is the only
// call site that makes two chats with one provider instance (initial pattern,
// then the first question), so: responses[0] is the pattern every code prompt
// gets (initial, each evolution, outro) and responses[1] is poll 1's question.
// Every later question re-reads responses[0].
const FIRST_QUESTION = llmScript.responses[1] ?? ''

const POLL_OPEN_WINDOW_MS = 5_000
const OUTRO_WINDOW_MS = 60_000
/** Observation window for "audio stayed stopped after `ended`". */
const AUDIO_SILENCE_WINDOW_MS = 4_000

test.setTimeout(300_000)

/**
 * The host browser is the audio engine, so headless audio can only be observed
 * through the Web Audio graph. Count node starts (buffer sources for `s(...)`
 * samples, oscillators for synth sounds) on `window` — the technique Task 12
 * used for the stop-on-ended fix. A `WeakSet` de-duplicates nodes in case both
 * prototypes expose `start`.
 */
const countAudioStarts = (): void => {
	// Index signature for the Web Audio globals: `AudioBufferSourceNode` / etc.
	// are PascalCase DOM names, which the project's naming rule rejects as typed
	// object properties.
	const w = window as unknown as {
		__audioStarts?: number
	} & Record<string, unknown>
	w.__audioStarts = 0
	const seen = new WeakSet<object>()
	const wrap = (ctor: unknown): void => {
		const proto = (
			ctor as { prototype?: { start?: (...args: unknown[]) => unknown } }
		)?.prototype
		if (!proto || typeof proto.start !== 'function') return
		const original = proto.start
		proto.start = function (this: object, ...args: unknown[]): unknown {
			if (!seen.has(this)) {
				seen.add(this)
				w.__audioStarts = (w.__audioStarts ?? 0) + 1
			}
			return original.apply(this, args)
		}
	}
	wrap(w.AudioScheduledSourceNode)
	wrap(w.AudioBufferSourceNode)
}

async function audioStarts(page: Page): Promise<number> {
	return page.evaluate(
		() => (window as unknown as { __audioStarts?: number }).__audioStarts ?? 0,
	)
}

/** Signup helper pattern (`e2e/auth.spec.ts`). */
async function signUp(page: Page, email: string): Promise<void> {
	await page.goto('/login')
	await page.getByRole('button', { name: 'Sign up' }).click()
	await page.getByPlaceholder('Name').fill('Host')
	await page.getByPlaceholder('Email').fill(email)
	await page.getByPlaceholder('Password').fill('password123')
	await page.locator('form button[type=submit]').click()
	await expect(page).toHaveURL(/\/$/)
}

/** `data-testid` of the poll's first option, plus its option key. */
async function firstOption(
	page: Page,
): Promise<{ testId: string; key: string }> {
	const button = page.getByTestId(/^vote-option-/).first()
	const testId = await button.getAttribute('data-testid')
	if (!testId) throw new Error('poll option has no data-testid')
	return { testId, key: testId.replace('vote-option-', '') }
}

async function sessionToken(context: BrowserContext): Promise<string> {
	const cookies = await context.cookies()
	const token = cookies.find((cookie) => cookie.name === 'mv_session')?.value
	if (!token) throw new Error('mv_session cookie missing')
	return token
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one linear end-to-end scenario, kept as a single scrollable narrative
test('host runs a set that the audience votes through, undoes, and ends', async ({
	browser,
}) => {
	const hostContext = await browser.newContext()
	const phoneAContext = await browser.newContext()
	const phoneBContext = await browser.newContext()
	const host = await hostContext.newPage()
	const phoneA = await phoneAContext.newPage()
	const phoneB = await phoneBContext.newPage()

	await host.addInitScript(countAudioStarts)

	// --- host signs up and creates the room ------------------------------
	await signUp(host, `e2e-cycle-${Date.now()}@example.com`)
	await host.goto('/create')
	// Schema minimums: 5 min / 5s / 15s (FAST only shrinks the poll open window).
	await host.getByLabel('Length in minutes (5–60)').fill('5')
	await host.getByLabel('Poll interval in seconds (5–600)').fill('60')
	// Exercise the per-room open-window field; FAST still forces 5s at runtime.
	await host.getByLabel('Poll open window in seconds (15–600)').fill('15')
	await host.getByTestId('create-room').click()
	await expect(host).toHaveURL(/\/r\/[^/]+\/host/)
	await expect(host.getByTestId('room-status')).toHaveText('lobby')
	// Step 1 of the brief: the host page shows the scannable QR, not just the URL.
	await expect(host.getByTestId('qr-code')).toBeVisible({ timeout: 15_000 })
	const voteUrl = (await host.getByTestId('vote-url').innerText()).trim()

	// Both phones open the QR target and wait in the lobby. They are already
	// connected when the poll opens, which keeps every 5s voting window safe.
	for (const phone of [phoneA, phoneB]) {
		await phone.goto(voteUrl)
		await expect(phone.getByTestId('waiting-dj')).toBeVisible()
	}

	// --- start: QR stays, music starts, poll 1 opens ---------------------
	await host.getByTestId('start-room').click()
	await expect(host.getByTestId('room-status')).toHaveText('live')
	// A real click is the gesture that unlocks the host's AudioContext.
	await host.getByTestId('vote-url').click()

	await expect(phoneA.getByTestId('poll-card')).toBeVisible({
		timeout: 30_000,
	})
	await expect(phoneB.getByTestId('poll-card')).toBeVisible({
		timeout: 30_000,
	})
	// Options are rendered from the poll's own option list; the spec never
	// assumes how many there are or what they say.
	await expect(phoneA.getByTestId('poll-question')).toHaveText(FIRST_QUESTION)
	const { testId: optionTestId, key: optionKey } = await firstOption(phoneA)

	await expect
		.poll(() => audioStarts(host), { timeout: 30_000 })
		.toBeGreaterThan(0)

	// --- phone A votes, phone B votes, phone A votes again ---------------
	await phoneA.getByTestId(optionTestId).click()
	await expect(phoneA.getByTestId('vote-counted')).toBeVisible()
	const phoneAToken = await sessionToken(phoneAContext)

	// Phone B votes while phone A reloads. The reload re-mints `mv_session`
	// (known backend gap: a fresh token would be allowed a second vote), so the
	// phone's ORIGINAL token is restored from the jar before the duplicate tap.
	// That is what makes the retry a real duplicate of the same poll.
	await Promise.all([
		(async (): Promise<void> => {
			await phoneB.getByTestId(optionTestId).click()
			await expect(phoneB.getByTestId('vote-counted')).toBeVisible()
		})(),
		(async (): Promise<void> => {
			await phoneA.reload()
			await expect(phoneA.getByTestId('poll-card')).toBeVisible({
				timeout: 10_000,
			})
			// Wait for the mount claim to finish re-minting the cookie, then put the
			// original token back so the next tap is a genuine duplicate.
			await expect.poll(() => sessionToken(phoneAContext)).not.toBe(phoneAToken)
			await phoneAContext.addCookies([
				{
					name: 'mv_session',
					value: phoneAToken,
					domain: 'localhost',
					path: '/',
				},
			])
		})(),
	])

	await phoneA.getByTestId(optionTestId).click()
	// Duplicate vote renders the counted state, never an error alert.
	await expect(phoneA.getByTestId('vote-counted')).toBeVisible({
		timeout: POLL_OPEN_WINDOW_MS,
	})
	await expect(phoneA.getByTestId('vote-error')).toHaveCount(0)

	// Two accepted votes, not three: the duplicate was rejected by the server.
	// Read the count element's own text — a substring match would also accept
	// "12"/"20".
	const hostOptionRow = host.getByTestId(`poll-option-${optionKey}`)
	const hostTally = hostOptionRow.locator('span').last()
	await expect
		.poll(async () => (await hostTally.innerText()).trim(), { timeout: 10_000 })
		.toBe('2')

	// --- poll 1 closes: the winning option drives the evolution ----------
	await expect(host.getByTestId('apply-status')).toHaveText('change applied', {
		timeout: 30_000,
	})

	// Audio keeps producing new voices while the set is live.
	const liveStarts = await audioStarts(host)
	await expect
		.poll(() => audioStarts(host), { timeout: 20_000 })
		.toBeGreaterThan(liveStarts)

	// --- next poll cycle: a voted poll, then a zero-vote poll ------------
	await expect(phoneA.getByTestId('poll-card')).toBeHidden({ timeout: 30_000 })
	await expect(phoneA.getByTestId('poll-card')).toBeVisible({
		timeout: 90_000,
	})
	await expect(phoneA.getByTestId('poll-question')).not.toHaveText(
		FIRST_QUESTION,
	)
	const secondPollOption = await firstOption(phoneA)
	await phoneA.getByTestId(secondPollOption.testId).click()
	await expect(phoneA.getByTestId('vote-counted')).toBeVisible()

	// Poll 3 opens with no votes at all: it must never reach the summary.
	await expect(phoneA.getByTestId('poll-card')).toBeHidden({ timeout: 30_000 })
	await expect(phoneA.getByTestId('poll-card')).toBeVisible({
		timeout: 90_000,
	})

	// --- host undoes the last change -------------------------------------
	await host.getByTestId('undo').click()
	await expect(host.getByTestId('apply-status')).toHaveText('reverted', {
		timeout: 15_000,
	})

	// --- host ends the set ------------------------------------------------
	await host.getByTestId('end-room').click()
	await expect(host.getByTestId('room-status')).toHaveText('outro', {
		timeout: 30_000,
	})
	// The outro is the last code_update and goes through the same apply loop.
	await expect(host.getByTestId('apply-status')).toHaveText('change applied', {
		timeout: 30_000,
	})

	await expect(host.getByTestId('room-status')).toHaveText('ended', {
		timeout: OUTRO_WINDOW_MS + 30_000,
	})

	// --- audio actually ran, and actually stopped -------------------------
	// The `ended` effect hushes the engine on the render after the status flips,
	// so one already-scheduled voice can still land. Wait for quiescence first...
	await expect
		.poll(
			async () => {
				const before = await audioStarts(host)
				await host.waitForTimeout(1_000)
				return (await audioStarts(host)) - before
			},
			{ timeout: 15_000, intervals: [1_000] },
		)
		.toBe(0)
	// ...then confirm a full window really is silent (a live set adds ~3/s).
	const startsAtEnd = await audioStarts(host)
	// Fixed observation window: this measures the ABSENCE of new voices after
	// `ended`, it does not stand in for waiting on an event.
	await host.waitForTimeout(AUDIO_SILENCE_WINDOW_MS)
	expect(await audioStarts(host)).toBe(startsAtEnd)

	// --- the audience sees the decided polls only ------------------------
	await expect(phoneB.getByTestId('poll-timeline')).toBeVisible({
		timeout: 30_000,
	})
	const timelineItems = phoneB.getByTestId('timeline-item')
	// Three polls were created (two evolution polls we voted on, plus the
	// zero-vote one we watched open); only the two decided ones render.
	await expect(timelineItems).toHaveCount(2)
	const itemTexts = await timelineItems.allInnerTexts()
	const firstQuestionItems = itemTexts.filter((text) =>
		text.includes(FIRST_QUESTION),
	)
	const otherItems = itemTexts.filter((text) => !text.includes(FIRST_QUESTION))
	expect(firstQuestionItems).toHaveLength(1)
	expect(otherItems).toHaveLength(1)
	for (const text of itemTexts) {
		expect(text).toContain(optionKey)
		expect(text).toContain('music changed')
	}

	await expect(phoneA.getByTestId('poll-timeline')).toBeVisible({
		timeout: 30_000,
	})

	await hostContext.close()
	await phoneAContext.close()
	await phoneBContext.close()
})
