// Production frontend build. Uses Bun.build (JS API) instead of the
// `bun build` CLI so we can register a plugin that stubs out the TanStack
// devtools packages. Bun's bundler does not tree-shake dead dynamic imports,
// so without this stub the ~270KB devtools libs would ship in the prod bundle
// even though AppDevtools returns null in production.
//
// In dev (`bun --hot backend/server.ts`) the dev server bundles the real
// devtools packages, so the panels work locally. Only the production build
// uses this script + stub.
import { $ } from 'bun'

const STUB_PATH = new URL(
	'../frontend/components/devtools-stub.ts',
	import.meta.url,
).pathname

const DEVTOOLS_PACKAGES = [
	'@tanstack/react-devtools',
	'@tanstack/react-form-devtools',
	'@tanstack/react-query-devtools',
	'@tanstack/react-router-devtools',
]

const devtoolsStubPlugin: BunPlugin = {
	name: 'prod-devtools-stub',
	setup(build): void {
		const filter = new RegExp(
			`^(${DEVTOOLS_PACKAGES.map((p) => p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`,
		)
		build.onResolve({ filter }, () => ({ path: STUB_PATH }))
	},
}

const result = await Bun.build({
	entrypoints: ['frontend/index.html'],
	outdir: 'dist',
	target: 'browser',
	minify: true,
	publicPath: '/',
	define: { 'process.env.NODE_ENV': '"production"' },
	plugins: [devtoolsStubPlugin],
	// React Compiler (experimental, Bun native). Off via REACT_COMPILER=0.
	// Runs only in the prod bundler — `bun --hot` dev server is unaffected.
	// Cannot fail the build: Bun falls back to original source on any bailout.
	reactCompiler: process.env.REACT_COMPILER !== '0',
	reactCompilerOutputMode: 'client',
})

if (!result.success) {
	for (const log of result.logs) console.error(log)
	process.exit(1)
}

// Recompile the hashed CSS emitted by the HTML bundler with Tailwind + daisyUI.
await $`bun run scripts/prod-css.ts`
console.log('build done')
