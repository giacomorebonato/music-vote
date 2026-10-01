import { AppLayout } from '@frontend/components/app-layout'
import { useTRPC } from '@frontend/lib/trpc'
import { useQuery } from '@tanstack/react-query'

export function HomeRoute() {
	const trpc = useTRPC()
	const { data, isPending } = useQuery(trpc.public.siteInfo.queryOptions())
	return (
		<AppLayout>
			<div className="flex max-w-md flex-col gap-4">
				<div className="flex flex-col gap-1">
					<span className="eyebrow">home</span>
					<h1 className="font-bold text-3xl">{data?.name ?? 'mino-starter'}</h1>
				</div>
				<p className="opacity-80">
					{isPending ? 'Loading…' : (data?.tagline ?? '')}
				</p>
			</div>
		</AppLayout>
	)
}
