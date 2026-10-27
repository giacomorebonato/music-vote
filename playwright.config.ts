import { defineConfig } from '@playwright/test'

const baseURL = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
	testDir: './e2e',
	testIgnore: /ssr\.spec\.ts$/,
	globalSetup: './e2e/global-setup.ts',
	use: { baseURL },
	webServer: {
		// The full-cycle spec drives the real HTTP/WS surface against a scripted
		// LLM: `LLM_PROVIDER=mock` + `LLM_MOCK_SCRIPT` (no network model) and
		// the production 10-second crowd cadence stays intact.
		// The DB reset runs first, in the same shell: it cannot live in globalSetup
		// (which Playwright runs after the server is already up).
		command: `bash scripts/e2e-reset-db.sh && DATABASE_URL=file:./test.db BETTER_AUTH_SECRET='ExNy8Q9ALAjH2BEc31RrQ+KNFG4K+KjprJexVc9Xw80=' BETTER_AUTH_URL=${baseURL} NODE_ENV=development LLM_PROVIDER=mock LLM_MOCK_SCRIPT=e2e/fixtures/llm-script.json bun run backend/server.ts`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 30000,
	},
})
