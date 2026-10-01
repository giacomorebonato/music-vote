import { AppDevtools } from '@frontend/components/devtools'
import { TRPCProvider } from '@frontend/lib/trpc'
import { RouterProvider, router } from '@frontend/router'
import type { AppRouter } from '@shared/trpc'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createRoot } from 'react-dom/client'

const queryClient = new QueryClient()
const trpcClient = createTRPCClient<AppRouter>({
	links: [httpBatchLink({ url: '/api/trpc' })],
})

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
	<QueryClientProvider client={queryClient}>
		<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
			<RouterProvider router={router} />
			<AppDevtools />
		</TRPCProvider>
	</QueryClientProvider>,
)
