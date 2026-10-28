import { expect, test } from '@playwright/test'

test.use({
	launchOptions: {
		args: [
			'--use-fake-device-for-media-stream',
			'--use-fake-ui-for-media-stream',
			'--autoplay-policy=no-user-gesture-required',
		],
	},
})
test.setTimeout(150_000)

test('listeners revise text and record a sound that is approved, played, and withdrawn', async ({
	browser,
}) => {
	const hostContext = await browser.newContext()
	const phoneContext = await browser.newContext({
		permissions: ['microphone'],
		viewport: { width: 390, height: 844 },
	})
	const otherContext = await browser.newContext()
	const host = await hostContext.newPage()
	const phone = await phoneContext.newPage()
	const other = await otherContext.newPage()
	try {
		await host.addInitScript(() => {
			const w = window as unknown as { __crowdStarts: number }
			w.__crowdStarts = 0
			const buffers = new WeakSet<AudioBuffer>()
			const decode = BaseAudioContext.prototype.decodeAudioData
			BaseAudioContext.prototype.decodeAudioData = function (
				data,
				success,
				failure,
			) {
				const crowd =
					data.byteLength > 28 &&
					new DataView(data).getUint32(24, true) === 24000
				const decoded = decode.call(this, data, success, failure)
				if (crowd) void decoded.then((buffer) => buffers.add(buffer))
				return decoded
			}
			const start = AudioBufferSourceNode.prototype.start
			AudioBufferSourceNode.prototype.start = function (
				...args: Parameters<AudioBufferSourceNode['start']>
			) {
				if (this.buffer && buffers.has(this.buffer)) w.__crowdStarts++
				return start.apply(this, args)
			}
		})
		await host.goto('/login')
		await host.getByRole('button', { name: 'Sign up' }).click()
		await host.getByPlaceholder('Name').fill('Contributions host')
		await host
			.getByPlaceholder('Email')
			.fill(`contributions-${Date.now()}@example.com`)
		await host.getByPlaceholder('Password').fill('password123')
		await host.locator('form button[type=submit]').click()
		await expect(host).toHaveURL(/\/$/)
		await host.goto('/create')
		await host.getByTestId('create-room').click()
		await expect(host).toHaveURL(/\/r\/[^/]+\/host/)
		await expect(host.getByTestId('qr-code')).toBeVisible({ timeout: 15_000 })
		const voteUrl = (await host.getByTestId('vote-url').innerText()).trim()
		await host
			.getByRole('checkbox', { name: 'Recorded sounds', exact: true })
			.check()
		await host.getByTestId('start-room').click()
		await expect(host.getByTestId('room-status')).toHaveText('live', {
			timeout: 30_000,
		})
		await phone.goto(voteUrl)
		await other.goto(voteUrl)
		await expect(phone.getByTestId('preference-question')).toHaveCount(7)
		await phone.getByTestId('vote-option-bouncy').click()
		await phone.getByRole('button', { name: 'Clear answer' }).click()
		await expect(phone.getByTestId('vote-option-bouncy')).toHaveAttribute(
			'aria-pressed',
			'false',
		)
		await phone
			.getByRole('textbox', { name: 'Your idea' })
			.fill('Underwater, with bouncy bass')
		await phone.getByRole('button', { name: 'Review direction' }).click()
		await expect(
			phone.getByText('bass: Bouncy · space: Spacious', { exact: true }),
		).toBeVisible()
		await phone.getByRole('button', { name: 'Use this direction' }).click()
		await expect(phone.getByText(/Current: bass: Bouncy/)).toBeVisible()
		await expect(
			other.getByText('Underwater, with bouncy bass', { exact: false }),
		).toHaveCount(0)
		await phone.reload()
		await expect(phone.getByRole('textbox', { name: 'Your idea' })).toHaveValue(
			'Underwater, with bouncy bass',
		)
		await phone.getByRole('button', { name: 'Clear direction' }).click()
		await expect(phone.getByText('Direction withdrawn.')).toBeVisible()
		await phone
			.getByRole('button', { name: 'Record a sound', exact: true })
			.click()
		await expect(
			phone.getByRole('button', { name: 'Stop recording' }),
		).toBeVisible()
		await expect(phone.getByRole('button', { name: 'Send sound' })).toBeVisible(
			{ timeout: 10_000 },
		)
		await phone.getByRole('button', { name: 'Send sound' }).click()
		await expect(phone.getByText(/Waiting for host approval/)).toBeVisible({
			timeout: 20_000,
		})
		await host.getByRole('button', { name: 'Approve', exact: true }).click()
		await expect(
			phone.getByText('percussion: applied', { exact: true }),
		).toBeVisible({ timeout: 30_000 })
		await expect
			.poll(
				() =>
					host.evaluate(
						() =>
							(window as unknown as { __crowdStarts: number }).__crowdStarts,
					),
				{ timeout: 10_000 },
			)
			.toBeGreaterThan(0)
		// Recover the asset manifest after a host reload while the clip is still eligible.
		await host.reload()
		await expect(host.getByTestId('room-status')).toHaveText('live')
		await phone.getByRole('button', { name: 'Withdraw', exact: true }).click()
		await expect(
			phone.getByText('percussion: withdrawn', { exact: true }),
		).toBeVisible()
		await expect(
			host.getByRole('button', { name: 'Remove', exact: true }),
		).toHaveCount(0, { timeout: 10_000 })
		await host
			.getByRole('checkbox', { name: 'Recorded sounds', exact: true })
			.uncheck()
		await expect(
			phone.getByRole('button', { name: 'Record a sound', exact: true }),
		).toHaveCount(0, { timeout: 10_000 })
		await phone.reload()
		await expect(
			phone.getByText('percussion: withdrawn', { exact: true }),
		).toBeVisible()
	} finally {
		await hostContext.close()
		await phoneContext.close()
		await otherContext.close()
	}
})
