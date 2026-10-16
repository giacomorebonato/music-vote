import { AppLayout } from '@frontend/components/app-layout'
import { authClient } from '@frontend/lib/auth'
import { useTRPC } from '@frontend/lib/trpc'
import { createRoomSchema } from '@shared/schemas/room'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

export function CreateRoute() {
	const trpc = useTRPC()
	const navigate = useNavigate()
	const { data: session, isPending } = authClient.useSession()
	const signedIn = Boolean(session?.user)

	const createRoom = useMutation(
		trpc.rooms.create.mutationOptions({
			onSuccess: (data) => {
				void navigate({ to: '/r/$id/host', params: { id: data.id } })
			},
		}),
	)

	const form = useForm({
		defaultValues: {
			genre: 'house',
			bpm: 120,
			lengthMin: 10,
			pollIntervalSec: 60,
			pollOpenSec: 20,
		},
		validators: { onChange: createRoomSchema },
		onSubmit: ({ value }) => {
			createRoom.mutate(value)
		},
	})

	if (isPending) {
		return (
			<AppLayout>
				<span className="loading loading-spinner" />
			</AppLayout>
		)
	}

	if (!signedIn) {
		return (
			<AppLayout>
				<div className="alert max-w-md">
					<span>Sign in to host a room.</span>
					<Link to="/login" className="btn btn-sm">
						Sign in
					</Link>
				</div>
			</AppLayout>
		)
	}

	return (
		<AppLayout>
			<div className="flex max-w-sm flex-col gap-6">
				<div className="flex flex-col gap-1">
					<span className="eyebrow">new room</span>
					<h1 className="font-bold text-2xl">Host a set</h1>
					<p className="text-sm opacity-70">
						Pick the vibe. The room starts in the lobby once you press start.
					</p>
				</div>

				<form
					className="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault()
						void form.handleSubmit()
					}}
				>
					<form.Field name="genre">
						{(field) => (
							<label className="form-control flex flex-col gap-1">
								<span className="label-text">Genre</span>
								<input
									className="input input-bordered w-full"
									placeholder="house"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</label>
						)}
					</form.Field>

					<form.Field name="bpm">
						{(field) => (
							<label className="form-control flex flex-col gap-1">
								<span className="label-text">BPM (60–200)</span>
								<input
									className="input input-bordered w-full"
									type="number"
									min={60}
									max={200}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(event.target.valueAsNumber)
									}
								/>
							</label>
						)}
					</form.Field>

					<form.Field name="lengthMin">
						{(field) => (
							<label className="form-control flex flex-col gap-1">
								<span className="label-text">Length in minutes (5–60)</span>
								<input
									className="input input-bordered w-full"
									type="number"
									min={5}
									max={60}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(event.target.valueAsNumber)
									}
								/>
							</label>
						)}
					</form.Field>

					<form.Field name="pollIntervalSec">
						{(field) => (
							<label className="form-control flex flex-col gap-1">
								<span className="label-text">
									Dance time between rounds in seconds (5–600)
								</span>
								<input
									className="input input-bordered w-full"
									type="number"
									min={5}
									max={600}
									step={5}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(event.target.valueAsNumber)
									}
								/>
							</label>
						)}
					</form.Field>

					<form.Field name="pollOpenSec">
						{(field) => (
							<label className="form-control flex flex-col gap-1">
								<span className="label-text">
									Time to vote in seconds (15–600)
								</span>
								<input
									className="input input-bordered w-full"
									type="number"
									min={15}
									max={600}
									step={5}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(event.target.valueAsNumber)
									}
								/>
								<span className="text-xs opacity-60">
									Countdown while the crowd chooses.
								</span>
							</label>
						)}
					</form.Field>

					<form.Subscribe
						selector={(state) => [
							state.values.pollIntervalSec,
							state.values.pollOpenSec,
						]}
					>
						{([intervalSec, openSec]) =>
							Number.isFinite(intervalSec) && Number.isFinite(openSec) ? (
								<p className="text-xs opacity-60" data-testid="cycle-estimate">
									≈ {intervalSec}s to dance after each result, then {openSec}s
									to vote
								</p>
							) : null
						}
					</form.Subscribe>

					{createRoom.error ? (
						<div className="alert alert-error" data-testid="create-error">
							{createRoom.error.message}
						</div>
					) : null}

					<form.Subscribe
						selector={(state) => [state.canSubmit, state.isSubmitting]}
					>
						{([canSubmit, isSubmitting]) => (
							<button
								type="submit"
								className="btn btn-primary"
								data-testid="create-room"
								disabled={!canSubmit || isSubmitting || createRoom.isPending}
							>
								{createRoom.isPending ? 'Creating…' : 'Create room'}
							</button>
						)}
					</form.Subscribe>
				</form>
			</div>
		</AppLayout>
	)
}
