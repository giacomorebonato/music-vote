import { expect, type Page, test } from '@playwright/test'

test.setTimeout(120_000)

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

test('a host steering note regenerates the current pattern once', async ({
	browser,
}) => {
	const context = await browser.newContext()
	const page = await context.newPage()
	await signUp(page, `e2e-steer-${Date.now()}@example.com`)
	await page.goto('/create')
	await page.getByTestId('create-room').click()
	await expect(page).toHaveURL(/\/r\/[^/]+\/host/)
	await expect(page.getByTestId('qr-code')).toBeVisible({ timeout: 15_000 })
	await page.getByTestId('start-room').click()
	await expect(page.getByTestId('room-status')).toHaveText('live', {
		timeout: 15_000,
	})

	const steerInput = page.getByTestId('steer-input')
	const steerButton = page.getByTestId('steer-submit')
	await expect(steerInput).toBeEnabled()
	const before = (await page.getByTestId('current-code').innerText()).trim()

	await steerInput.fill('bring the drums forward')
	await steerButton.click()
	// The delivered candidate replaces the playing pattern.
	await expect(page.getByTestId('current-code')).not.toHaveText(before, {
		timeout: 30_000,
	})
	// The consumed note cleared and the room stayed live.
	await expect(steerInput).toHaveValue('')
	await expect(page.getByTestId('room-status')).toHaveText('live')
})
