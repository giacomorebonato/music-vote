import { expect, test } from '@playwright/test'

test('signup lands on home', async ({ page }) => {
	await page.goto('/login')
	await page.getByRole('button', { name: 'Sign up' }).click()
	await page.getByPlaceholder('Name').fill('Test User')
	await page.getByPlaceholder('Email').fill(`e2e-${Date.now()}@example.com`)
	await page.getByPlaceholder('Password').fill('password123')
	await page.locator('form button[type=submit]').click()
	await expect(page).toHaveURL(/\/$/)
})
