import { playCrowdSample, stopCrowdSample } from '@frontend/audio/crowd-sampler'
import { useTRPC } from '@frontend/lib/trpc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

export function ContributionMonitor({
	roomId,
	live,
}: {
	roomId: string
	live: boolean
}) {
	const trpc = useTRPC()
	const queryClient = useQueryClient()
	const query = useQuery({
		...trpc.contributions.host.queryOptions({ roomId }),
		refetchInterval: 2000,
	})
	const settings = useMutation(trpc.contributions.settings.mutationOptions())
	const moderate = useMutation(trpc.contributions.moderate.mutationOptions())
	const [error, setError] = useState<string | null>(null)
	const currentSample = useRef<string | null>(null)
	const active = query.data?.activeSample
	useEffect(() => {
		if (!live || !active) {
			if (currentSample.current) stopCrowdSample()
			currentSample.current = null
			return
		}
		if (currentSample.current === active.id) return
		currentSample.current = active.id
		void playCrowdSample(active).catch((e) => {
			currentSample.current = null
			setError(
				e instanceof Error ? e.message : 'Could not recover the crowd sample.',
			)
		})
	}, [live, active])
	useEffect(() => () => stopCrowdSample(), [])
	async function run(task: () => Promise<unknown>) {
		setError(null)
		try {
			await task()
			await query.refetch()
		} catch (e) {
			setError(
				e instanceof Error ? e.message : 'Could not update contributions.',
			)
			void query.refetch()
		}
	}
	const data = query.data
	if (!data) return null
	return (
		<section className="card bg-base-100 shadow-xl">
			<div className="card-body gap-3 p-4">
				<h2 className="font-bold text-lg">Crowd contributions</h2>
				<div className="flex flex-wrap gap-4">
					{(
						[
							{ key: 'textEnabled', label: 'Text directions' },
							{ key: 'recordingsEnabled', label: 'Recorded sounds' },
							{ key: 'momentsEnabled', label: 'Audience moments' },
							{ key: 'sampleApproval', label: 'Approve sounds first' },
						] as const
					).map(({ key, label }) => (
						<label className="flex items-center gap-2" key={key}>
							<input
								type="checkbox"
								className="toggle toggle-sm"
								checked={data.settings[key]}
								disabled={settings.isPending}
								onChange={(e) => {
									const next = { ...data.settings, [key]: e.target.checked }
									queryClient.setQueryData(
										trpc.contributions.host.queryKey({ roomId }),
										{ ...data, settings: next },
									)
									void run(() =>
										settings.mutateAsync({
											roomId,
											...data.settings,
											[key]: e.target.checked,
										}),
									)
								}}
							/>
							{label}
						</label>
					))}
				</div>
				{data.directions.map((d) => (
					<div key={d.id} className="flex items-center justify-between gap-2">
						<p className="text-sm break-words">
							{d.text} · {d.outcome}
						</p>
						<button
							type="button"
							className="btn btn-ghost btn-sm"
							onClick={() => {
								void run(() =>
									moderate.mutateAsync({
										roomId,
										kind: 'direction',
										id: d.id,
										action: 'remove',
									}),
								)
							}}
						>
							Dismiss
						</button>
					</div>
				))}
				{data.recordings.length ? (
					<p className="text-sm opacity-70">
						Preview plays through this browser’s output, including the PA.
					</p>
				) : null}
				{data.recordings.map((r) => (
					<div className="flex flex-wrap items-center gap-2" key={r.id}>
						<span className="text-sm">
							{r.use} · {r.status}
						</span>
						{r.sample ? (
							<audio
								className="max-w-full"
								controls
								preload="none"
								src={r.sample.url}
								aria-label={`Preview ${r.use} recording`}
							/>
						) : null}
						{r.status === 'review' ? (
							<button
								type="button"
								className="btn btn-primary btn-sm"
								disabled={!live || moderate.isPending}
								onClick={() => {
									void run(() =>
										moderate.mutateAsync({
											roomId,
											kind: 'recording',
											id: r.id,
											action: 'approve',
										}),
									)
								}}
							>
								Approve
							</button>
						) : null}
						<button
							type="button"
							className="btn btn-ghost btn-sm"
							disabled={moderate.isPending}
							onClick={() => {
								void run(() =>
									moderate.mutateAsync({
										roomId,
										kind: 'recording',
										id: r.id,
										action: 'remove',
									}),
								)
							}}
						>
							Remove
						</button>
					</div>
				))}
				{error ? (
					<p role="alert" className="text-error">
						{error}
					</p>
				) : null}
			</div>
		</section>
	)
}
