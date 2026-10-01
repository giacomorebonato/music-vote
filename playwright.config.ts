import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './e2e',
	testIgnore: /ssr\.spec\.ts$/,
	globalSetup: './e2e/global-setup.ts',
	use: { baseURL: 'http://localhost:3000' },
	webServer: {
		command:
			"DATABASE_URL=file:./test.db BETTER_AUTH_SECRET='ExNy8Q9ALAjH2BEc31RrQ+KNFG4K+KjprJexVc9Xw80=' BETTER_AUTH_URL=http://localhost:3000 NODE_ENV=development bun run backend/server.ts",
		url: 'http://localhost:3000',
		reuseExistingServer: !process.env.CI,
		timeout: 30000,
	},
})
