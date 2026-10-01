// Production no-op stub for the TanStack devtools packages.
// `scripts/build.ts` redirects the four devtools package specifiers here in
// the production bundle so the (heavy) devtools code is never shipped. This
// module is only referenced by the dead `devtools-content` branch, which the
// `AppDevtools` guard never renders in production.
import type { FC } from 'react'

const Noop: FC<Record<string, unknown>> = () => null

export const TanStackDevtools = Noop
export const ReactQueryDevtoolsPanel = Noop
export const TanStackRouterDevtoolsPanel = Noop
export const formDevtoolsPlugin = (): { name: string } => ({ name: 'noop' })
