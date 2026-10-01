import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Regression guard for the Bun dev-server crash:
 *
 *   TypeError: Cannot read properties of null (reading 'replaceRouteChunk')
 *     at node_modules/@tanstack/router-core/dist/esm/router.js
 *
 * @tanstack/router-core 1.171.23 introduced a circular dependency
 * (load-client.js imports `getLocationChangeInfo`/`runRouteLifecycle` from
 * router.js, while router.js imports from load-client.js). Under Bun's HMR
 * dev bundler the router.js module reads the not-yet-initialised circular
 * import binding as `null` at module-eval time, so the whole app fails to
 * boot. Version 1.171.15 (react-router 1.170.18) has no cycle and works.
 *
 * The crash is specific to the dev server's HMR runtime and does NOT surface
 * under `bun test` or a plain `Bun.build`, so this test statically inspects
 * the installed router-core module graph for import cycles instead.
 *
 * Upgrade path: if this fails after a `bun update`, the newly resolved
 * @tanstack/router-core reintroduced a circular import. Downgrade back to
 * router-core 1.171.15 / react-router 1.170.18 (and keep the devtools family
 * version-aligned) until TanStack/Bun fixes circular-import handling.
 */

const ROUTER_CORE_PKG = '@tanstack/router-core/package.json'

function findCycles(imports: Record<string, string[]>): string[][] {
	const cycles: string[][] = []
	const state = new Map<string, 0 | 1 | 2>()
	const stack: string[] = []

	const visitNeighbor = (dep: string): void => {
		if (!(dep in imports)) return
		const s = state.get(dep)
		if (s === 1) {
			const start = stack.indexOf(dep)
			cycles.push([...stack.slice(start), dep])
			return
		}
		if (!s) visit(dep)
	}

	function visit(node: string): void {
		state.set(node, 1)
		stack.push(node)
		for (const dep of imports[node] ?? []) visitNeighbor(dep)
		stack.pop()
		state.set(node, 2)
	}

	for (const node of Object.keys(imports)) if (!state.get(node)) visit(node)
	return cycles
}

function buildImportGraph(dir: string): Record<string, string[]> {
	const graph: Record<string, string[]> = {}
	for (const file of readdirSync(dir)) {
		if (!file.endsWith('.js')) continue
		const source = readFileSync(join(dir, file), 'utf8')
		const deps: string[] = []
		const re = /from\s+"(\.[^"]+\.js)"/g
		for (const match of source.matchAll(re))
			deps.push(match[1].replace(/^\.\//, ''))
		graph[file] = deps
	}
	return graph
}

test('router-core has no circular imports that crash Bun dev', () => {
	const pkgUrl = import.meta.resolve(ROUTER_CORE_PKG)
	const pkgDir = dirname(pkgUrl.replace('file://', ''))
	const esmDir = join(pkgDir, 'dist', 'esm')

	const cycles = findCycles(buildImportGraph(esmDir))
	const cycleText = cycles.map((c) => c.join(' -> ')).join('\n  ')

	expect(
		cycles,
		[
			`@tanstack/router-core has ${cycles.length} circular import(s):`,
			`  ${cycleText}`,
			'',
			'This crashes the Bun dev server (HMR) at module-eval time:',
			"  TypeError: Cannot read properties of null (reading 'replaceRouteChunk')",
			'',
			'Fix: downgrade to @tanstack/router-core 1.171.15 / @tanstack/react-router 1.170.18',
			'(keep @tanstack/react-router-devtools aligned, e.g. 1.167.0) until TanStack/Bun',
			'fixes circular-import handling. See frontend/__tests__/router-core-no-circular.test.ts.',
		].join('\n'),
	).toHaveLength(0)
})
