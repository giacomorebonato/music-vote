import { AppLayout } from '@frontend/components/app-layout'
import { authClient } from '@frontend/lib/auth'
import { useTRPC } from '@frontend/lib/trpc'
import { createRoomSchema } from '@shared/schemas/room'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

const genreGroups = [
	{
		label: 'Electronic & dance',
		genres: [
			'Acid house',
			'Ambient',
			'Breakbeat',
			'Deep house',
			'Disco',
			'Downtempo',
			'Drum and bass',
			'Dubstep',
			'EDM',
			'Electro',
			'Garage',
			'House',
			'IDM',
			'Jungle',
			'Minimal techno',
			'Progressive house',
			'Synthwave',
			'Tech house',
			'Techno',
			'Trance',
			'Trip-hop',
		],
	},
	{
		label: 'Hip-hop, R&B & soul',
		genres: [
			'Boom bap',
			'Funk',
			'Hip-hop',
			'Lo-fi hip-hop',
			'Neo-soul',
			'R&B',
			'Soul',
			'Trap',
		],
	},
	{
		label: 'Pop, rock & alternative',
		genres: [
			'Alternative rock',
			'Dream pop',
			'Electropop',
			'Heavy metal',
			'Indie pop',
			'Indie rock',
			'Pop',
			'Psychedelic rock',
			'Punk rock',
			'Rock',
			'Synth-pop',
		],
	},
	{
		label: 'Jazz, blues & acoustic',
		genres: [
			'Blues',
			'Classical',
			'Country',
			'Folk',
			'Jazz',
			'Jazz fusion',
			'Smooth jazz',
			'Swing',
		],
	},
	{
		label: 'Latin, Caribbean & global',
		genres: [
			'Afrobeat',
			'Afrobeats',
			'Amapiano',
			'Bachata',
			'Bossa nova',
			'Dancehall',
			'Dub',
			'Flamenco',
			'Latin pop',
			'Reggae',
			'Reggaeton',
			'Salsa',
			'Samba',
		],
	},
]

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
								<select
									className="select select-bordered w-full"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								>
									{genreGroups.map((group) => (
										<optgroup key={group.label} label={group.label}>
											{group.genres.map((genre) => (
												<option key={genre} value={genre.toLowerCase()}>
													{genre}
												</option>
											))}
										</optgroup>
									))}
								</select>
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

					<p className="text-sm opacity-70">
						Three questions stay open throughout the set. People can change
						their answers anytime; the music listens for changes every 10
						seconds.
					</p>

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
