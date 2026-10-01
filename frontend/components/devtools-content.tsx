import { TanStackDevtools } from '@tanstack/react-devtools'
import { formDevtoolsPlugin } from '@tanstack/react-form-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'

// NOTE: the TanStack Router devtools panel is intentionally omitted.
// @tanstack/react-router-devtools requires @tanstack/router-core >=1.171.16
// (it reads `router._cache`), but every router-core >=1.171.16 introduces a
// circular import (load-client.js <-> router.js) that Bun's dev client
// bundler reads as `null` at module-eval, crashing the whole app with
// `Cannot read properties of null (reading 'replaceRouteChunk')`.
// We pin router-core 1.171.15 (no cycle, no `_cache`) and drop the Router
// panel until TanStack/Bun fix the circular-import handling. Query + Form
// devtools panels keep working. Re-enable by:
//   1. `bun add -D @tanstack/react-router-devtools@^1.170.19`
//   2. restore the `router` prop + the Router plugin entry below.
export function DevtoolsContent() {
	return (
		<TanStackDevtools
			config={{ position: 'bottom-right' }}
			plugins={[
				{
					name: 'TanStack Query',
					render: <ReactQueryDevtoolsPanel />,
				},
				formDevtoolsPlugin(),
			]}
		/>
	)
}
