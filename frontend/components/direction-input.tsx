import { useTRPC } from '@frontend/lib/trpc'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

export function DirectionInput({
	roomId,
	current,
	disabled,
	ensure,
	onChanged,
}: {
	roomId: string
	current: {
		text: string
		summary: string
		status: string
		outcome: string
	} | null
	disabled: boolean
	ensure: () => Promise<void>
	onChanged: () => void
}) {
	const trpc = useTRPC()
	const [text, setText] = useState(
		current?.status === 'active' ? current.text : '',
	)
	const [review, setReview] = useState<{
		reviewToken: string
		summary: string
		supported: boolean
	} | null>(null)
	const [error, setError] = useState<string | null>(null)
	const preview = useMutation(trpc.contributions.preview.mutationOptions())
	const submit = useMutation(trpc.contributions.submit.mutationOptions())
	const clear = useMutation(trpc.contributions.clear.mutationOptions())
	const pending = preview.isPending || submit.isPending || clear.isPending
	const run = async (task: () => Promise<unknown>) => {
		setError(null)
		try {
			await ensure()
			await task()
		} catch (e) {
			setError(
				e instanceof Error ? e.message : 'Could not send your direction.',
			)
		}
	}
	return (
		<section
			className="card bg-base-100 shadow-xl"
			aria-label="Your musical direction"
		>
			<div className="card-body gap-3 p-4">
				<h2 className="font-bold text-lg">Describe your direction</h2>
				<p className="text-sm opacity-70">
					One current idea. Edit or clear it whenever you like.
				</p>
				<label className="flex flex-col gap-1">
					Your idea
					<textarea
						className="textarea textarea-bordered w-full"
						maxLength={240}
						value={text}
						disabled={disabled || pending}
						placeholder="Bouncy bass, but keep the drums chilled…"
						onChange={(e) => {
							setText(e.target.value)
							setReview(null)
						}}
					/>
				</label>
				<button
					type="button"
					className="btn btn-outline"
					disabled={disabled || pending || !text.trim()}
					onClick={() => {
						void run(async () =>
							setReview(await preview.mutateAsync({ roomId, text })),
						)
					}}
				>
					Review direction
				</button>
				{review ? (
					<div className="flex flex-col gap-2" aria-live="polite">
						<p>{review.summary}</p>
						{review.supported ? (
							<button
								type="button"
								className="btn btn-primary"
								disabled={disabled || pending}
								onClick={() => {
									void run(async () => {
										await submit.mutateAsync({
											roomId,
											reviewToken: review.reviewToken,
										})
										setReview(null)
										onChanged()
									})
								}}
							>
								Use this direction
							</button>
						) : null}
					</div>
				) : null}
				{current ? (
					<p className="text-sm" aria-live="polite">
						{current.status === 'active'
							? `Current: ${current.summary}. ${current.outcome === 'applied' ? 'Included in a confirmed music update.' : current.outcome === 'held' ? 'The groove already fits; your direction stays active.' : current.outcome === 'failed' ? 'That update could not play.' : 'Received; waiting for the music.'}`
							: `Direction ${current.status}.`}
					</p>
				) : null}
				{current?.status === 'active' ? (
					<button
						type="button"
						className="btn btn-ghost btn-sm"
						disabled={disabled || pending}
						onClick={() => {
							void run(async () => {
								await clear.mutateAsync({ roomId })
								setText('')
								setReview(null)
								onChanged()
							})
						}}
					>
						Clear direction
					</button>
				) : null}
				{error ? (
					<p role="alert" className="text-error">
						{error}
					</p>
				) : null}
			</div>
		</section>
	)
}
