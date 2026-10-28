import { DirectionInput } from '@frontend/components/direction-input'
import { RecordingInput } from '@frontend/components/recording-input'
import { useTRPC } from '@frontend/lib/trpc'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export function CrowdContributions({
	roomId,
	live,
	ensure,
}: {
	roomId: string
	live: boolean
	ensure: () => Promise<void>
}) {
	const trpc = useTRPC()
	const [joined, setJoined] = useState(false)
	const [error, setError] = useState<string | null>(null)
	useEffect(() => {
		let active = true
		void ensure()
			.then(() => {
				if (active) setJoined(true)
			})
			.catch(() => {})
		return () => {
			active = false
		}
	}, [ensure])
	const mine = useQuery({
		...trpc.contributions.mine.queryOptions({ roomId }),
		enabled: joined,
		refetchInterval: 3000,
	})
	const withdraw = useMutation(trpc.contributions.withdraw.mutationOptions())
	const moment = useMutation(trpc.contributions.moment.mutationOptions())
	const changed = () => {
		void mine.refetch()
	}
	const data = mine.data
	if (!data) return null
	async function run(task: () => Promise<unknown>) {
		setError(null)
		try {
			await task()
			changed()
		} catch (e) {
			setError(
				e instanceof Error ? e.message : 'Could not update your contribution.',
			)
		}
	}
	return (
		<>
			{data.settings.textEnabled ? (
				<DirectionInput
					key={data.direction?.revision ?? 0}
					roomId={roomId}
					current={data.direction}
					disabled={!live}
					ensure={ensure}
					onChanged={changed}
				/>
			) : (
				<p className="text-sm opacity-70">
					Text directions are paused by the host.
				</p>
			)}
			{data.settings.recordingsEnabled ? (
				<RecordingInput
					roomId={roomId}
					disabled={!live}
					ensure={ensure}
					onChanged={changed}
				/>
			) : null}
			{data.recordings.length ? (
				<section className="card bg-base-100">
					<div className="card-body p-4">
						<h2 className="font-bold">Your sounds</h2>
						{data.recordings.map((r) => (
							<div
								key={r.id}
								className="flex flex-wrap items-center justify-between gap-2"
							>
								<p className="text-sm">
									{r.use}:{' '}
									{r.status === 'review'
										? 'Waiting for host approval'
										: r.status}
									{r.reason ? ` — ${r.reason}` : ''}
								</p>
								{!['expired', 'failed', 'rejected', 'withdrawn'].includes(
									r.status,
								) ? (
									<button
										type="button"
										className="btn btn-ghost btn-sm"
										disabled={!live || withdraw.isPending}
										onClick={() => {
											void run(() => withdraw.mutateAsync({ roomId, id: r.id }))
										}}
									>
										Withdraw
									</button>
								) : null}
							</div>
						))}
					</div>
				</section>
			) : null}
			{data.settings.momentsEnabled ? (
				<section className="card bg-base-100">
					<div className="card-body p-4">
						<h2 className="font-bold">Ask for a moment</h2>
						<p className="text-sm opacity-70">
							One request at a time. The room leaves space between moments.
						</p>
						<div className="flex flex-wrap gap-2">
							{(['build', 'drop', 'strip'] as const).map((action) => (
								<button
									type="button"
									className="btn btn-outline btn-sm"
									key={action}
									disabled={
										!live ||
										moment.isPending ||
										data.moments.some((m) =>
											['queued', 'preparing'].includes(m.status),
										)
									}
									onClick={() => {
										void run(() => moment.mutateAsync({ roomId, action }))
									}}
								>
									{
										{ build: 'Build up', drop: 'Drop', strip: 'Strip back' }[
											action
										]
									}
								</button>
							))}
						</div>
						{data.moments[0] ? (
							<p role="status" className="text-sm">
								Last request: {data.moments[0].status}
							</p>
						) : null}
					</div>
				</section>
			) : null}
			{error ? (
				<p role="alert" className="text-error">
					{error}
				</p>
			) : null}
		</>
	)
}
