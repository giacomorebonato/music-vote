import { defineConfig } from '@playwright/test'

const baseURL = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
	testDir: './e2e',
	testMatch: 'ssr.spec.ts',
	globalSetup: './e2e/global-setup.ts',
	use: { baseURL },
	webServer: {
		command: `bash scripts/e2e-reset-db.sh && bun run build && DATABASE_URL=file:./test.db BETTER_AUTH_SECRET='ExNy8Q9ALAjH2BEc31RrQ+KNFG4K+KjprJexVc9Xw80=' BETTER_AUTH_URL=${baseURL} NODE_ENV=production SSR_CACHE_DIR=/tmp/mino-ssr-cache-e2e bun run start`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 60000,
	},
})
