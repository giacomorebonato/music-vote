import { expect, type Page, test } from '@playwright/test'

test.setTimeout(180_000)

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

test('persistent crowd preferences remain editable across updates, reloads and set end', async ({
	browser,
}) => {
	const hostContext = await browser.newContext()
	const phoneAContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
	})
	const phoneBContext = await browser.newContext()
	const host = await hostContext.newPage()
	const phoneA = await phoneAContext.newPage()
	const phoneB = await phoneBContext.newPage()
	try {
		await host.addInitScript(countAudioStarts)
		await signUp(host, `e2e-preferences-${Date.now()}@example.com`)
		await host.goto('/create')
		await expect(host.getByText('Time to vote in seconds')).toHaveCount(0)
		await host.getByTestId('create-room').click()
		await expect(host).toHaveURL(/\/r\/[^/]+\/host/)
		await expect(host.getByTestId('qr-code')).toBeVisible({ timeout: 15_000 })
		const voteUrl = (await host.getByTestId('vote-url').innerText()).trim()
		for (const phone of [phoneA, phoneB]) {
			await phone.goto(voteUrl)
			await expect(phone.getByTestId('waiting-dj')).toBeVisible()
		}
		await host.getByTestId('start-room').click()
		await expect(host.getByTestId('room-status')).toHaveText('live', {
			timeout: 30_000,
		})
		await host.getByTestId('vote-url').click()
		await expect(phoneA.getByTestId('preference-question')).toHaveCount(3)
		await expect(phoneB.getByTestId('preference-question')).toHaveCount(3)
		await expect(host.getByTestId('poll-monitor')).toHaveCount(3)
		await expect(phoneA.getByTestId('poll-countdown')).toHaveCount(0)
		await expect
			.poll(() => audioStarts(host), { timeout: 30_000 })
			.toBeGreaterThan(0)

		// The real Strudel editor follows this same playing pattern and clock.
		const pattern = host.getByTestId('current-code')
		await expect(pattern.locator('.cm-content')).toContainText('s(')
		await expect(pattern.locator('.cm-content')).toHaveAttribute(
			'contenteditable',
			'false',
		)
		await expect
			.poll(() => pattern.locator('span[style*="outline"]').count(), {
				timeout: 10_000,
			})
			.toBeGreaterThan(0)
		const visual = host.getByTestId('pattern-visual')
		await expect(visual).toBeVisible()
		const firstFrame = await visual.evaluate((canvas) =>
			(canvas as HTMLCanvasElement).toDataURL(),
		)
		await expect
			.poll(() =>
				visual.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
			)
			.not.toBe(firstFrame)

		// Both phones contribute, then A replaces its choice. B sees every count.
		await phoneA.getByTestId('vote-option-mellow').click()
		await expect(phoneA.getByTestId('vote-option-mellow')).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await phoneB.getByTestId('vote-option-intense').click()
		await expect(phoneB.getByTestId('vote-option-mellow')).toContainText(
			'1 · 50%',
		)
		await expect(phoneB.getByTestId('vote-option-intense')).toContainText(
			'1 · 50%',
		)
		await phoneA.getByTestId('vote-option-intense').click()
		await expect(phoneB.getByTestId('vote-option-mellow')).toContainText(
			'0 · 0%',
		)
		await expect(phoneB.getByTestId('vote-option-intense')).toContainText(
			'2 · 100%',
		)
		await expect(
			host.getByTestId('poll-option-intense').locator('span').last(),
		).toHaveText('2')

		// Choices persist across a narrow phone reload without minting another vote.
		const token = (await phoneAContext.cookies()).find(
			(cookie) => cookie.name === 'mv_session',
		)?.value
		await phoneA.reload()
		await expect(phoneA.getByTestId('vote-option-intense')).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		expect(
			(await phoneAContext.cookies()).find(
				(cookie) => cookie.name === 'mv_session',
			)?.value,
		).toBe(token)
		await expect(phoneA.getByTestId('vote-option-mellow')).toBeEnabled()
		expect(
			await phoneA.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true)

		// The first changed snapshot generates code and reaches confirmed playback.
		await expect(phoneA.getByTestId('music-delivery')).toContainText(
			'has evolved',
			{ timeout: 30_000 },
		)
		await expect(host.getByTestId('apply-status')).toHaveText('change applied')
		await expect(phoneA.getByTestId('preference-question')).toHaveCount(3)
		await phoneA.getByTestId('vote-option-bright').click()
		await expect(phoneB.getByTestId('vote-option-bright')).toContainText(
			'1 · 100%',
		)
		// The scripted agent returns the same pattern for this snapshot: an honest hold.
		await expect(phoneA.getByTestId('music-delivery')).toContainText(
			'Let it ride',
			{ timeout: 30_000 },
		)
		await expect(phoneA.getByTestId('vote-option-mellow')).toBeEnabled()

		await host.getByTestId('undo').click()
		await expect(host.getByTestId('apply-status')).toHaveText('reverted')
		const liveStarts = await audioStarts(host)
		await expect
			.poll(() => audioStarts(host), { timeout: 15_000 })
			.toBeGreaterThan(liveStarts)
		await host.getByTestId('end-room').click()
		await expect(host.getByTestId('room-status')).toHaveText('outro', {
			timeout: 30_000,
		})
		await expect(phoneA.getByTestId('vote-option-mellow')).toBeDisabled()
		await expect(host.getByTestId('room-status')).toHaveText('ended', {
			timeout: 90_000,
		})
		await expect(pattern.locator('span[style*="outline"]')).toHaveCount(0)
		await expect
			.poll(() =>
				visual.evaluate((node) => {
					const canvas = node as HTMLCanvasElement
					return canvas
						.getContext('2d')
						?.getImageData(0, 0, canvas.width, canvas.height)
						.data.some((value) => value !== 0)
				}),
			)
			.toBe(false)

		await expect(phoneB.getByText('Thanks for the dance')).toBeVisible()
		await expect(phoneB.getByTestId('vote-option-intense')).toContainText(
			'2 · 100%',
		)
		await expect(phoneB.getByTestId('vote-option-intense')).toBeDisabled()

		await expect
			.poll(
				async () => {
					const before = await audioStarts(host)
					await host.waitForTimeout(1000)
					return (await audioStarts(host)) - before
				},
				{ timeout: 15_000, intervals: [1000] },
			)
			.toBe(0)
		const stopped = await audioStarts(host)
		await host.waitForTimeout(4000)
		expect(await audioStarts(host)).toBe(stopped)
	} finally {
		await hostContext.close()
		await phoneAContext.close()
		await phoneBContext.close()
	}
})
