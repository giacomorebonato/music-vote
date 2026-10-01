import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './e2e',
	testMatch: 'ssr.spec.ts',
	globalSetup: './e2e/global-setup.ts',
	use: { baseURL: 'http://localhost:3000' },
	webServer: {
		command:
			"bash scripts/e2e-reset-db.sh && bun run build && DATABASE_URL=file:./test.db BETTER_AUTH_SECRET='ExNy8Q9ALAjH2BEc31RrQ+KNFG4K+KjprJexVc9Xw80=' BETTER_AUTH_URL=http://localhost:3000 NODE_ENV=production SSR_CACHE_DIR=/tmp/mino-ssr-cache-e2e bun run start",
		url: 'http://localhost:3000',
		reuseExistingServer: !process.env.CI,
		timeout: 60000,
	},
})
