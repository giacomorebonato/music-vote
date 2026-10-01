import { expect, test } from '@playwright/test'

test.describe('drawer layout', () => {
	test('mobile: sidebar hidden, hamburger toggles overlay', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 800 })
		await page.goto('/')

		// sidebar overlay not visible initially
		const sidebar = page.locator('.drawer-side')
		await expect(sidebar).not.toBeVisible()

		// open via hamburger
		await page.getByTestId('drawer-open').click()
		await expect(sidebar).toBeVisible()

		// close via overlay (click the visible backdrop outside the sidebar)
		await page
			.getByTestId('drawer-close')
			.click({ position: { x: 350, y: 10 } })
		await expect(sidebar).not.toBeVisible()
	})

	test('desktop: sidebar pinned, hamburger hidden', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.goto('/')

		await expect(page.locator('.drawer-side')).toBeVisible()
		await expect(page.getByTestId('drawer-open')).not.toBeVisible()
	})

	test('bare route: no sidebar on /login (mobile + desktop)', async ({
		page,
	}) => {
		for (const [w, h] of [
			[375, 800],
			[1280, 800],
		] as const) {
			await page.setViewportSize({ width: w, height: h })
			await page.goto('/login')
			await expect(page.locator('.drawer-side')).toHaveCount(0)
			await expect(page.getByTestId('drawer-open')).toHaveCount(0)
		}
	})
})
