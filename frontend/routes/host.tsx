import type { ApplyResult } from '@frontend/audio/strudel-init'
import {
	StrudelPlayer,
	type StrudelPlayerRef,
} from '@frontend/audio/strudel-player'
import { AppLayout } from '@frontend/components/app-layout'
import { PollMonitor } from '@frontend/components/poll-monitor'
import { QrCode } from '@frontend/components/qr-code'
import {
	type ApplyStatus,
	type ApplyStatusFact,
	initialApplyStatusState,
	reduceApplyStatus,
} from '@frontend/lib/apply-status'
import { authClient } from '@frontend/lib/auth'
import { useRoomChannel } from '@frontend/lib/room-ws'
import { useTRPC } from '@frontend/lib/trpc'
import type { CodeUpdateEvent, WsEvent } from '@shared/realtime/events'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'

// Written as whole class literals so Tailwind/daisyUI emits them.
const APPLY_STATUS_CLASS: Record<ApplyStatus['tone'], string> = {
	success: 'badge-success',
	error: 'badge-error',
	warning: 'badge-warning',
}

export function HostRoute({ roomId }: { roomId: string }) {
	const { data: session, isPending } = authClient.useSession()

	if (isPending) {
		return (
			<AppLayout>
				<span className="loading loading-spinner" />
			</AppLayout>
		)
	}

	if (!session?.user) {
		return (
			<AppLayout>
				<div className="alert max-w-md">
					<span>Sign in to open the host console.</span>
					<Link to="/login" className="btn btn-sm">
						Sign in
					</Link>
				</div>
			</AppLayout>
		)
	}

	return <HostConsole roomId={roomId} />
}

function HostConsole({ roomId }: { roomId: string }) {
	const trpc = useTRPC()
	const queryClient = useQueryClient()

	const roomQuery = useQuery(trpc.rooms.get.queryOptions({ roomId }))
	const room = roomQuery.data?.room
	const openPoll = roomQuery.data?.openPoll
	const serverCounts = roomQuery.data?.voteCounts

	const [playerCode, setPlayerCode] = useState<string | null>(null)
	const [displayCode, setDisplayCode] = useState<string | null>(null)
	const [applyStatusState, setApplyStatusState] = useState(
		initialApplyStatusState,
	)
	const [voteTally, setVoteTally] = useState<{
		pollId: string
		counts: Record<string, number>
	} | null>(null)
	const [toast, setToast] = useState<string | null>(null)
	// Set while the backend turns a winning poll vote into a new pattern (an
	// evolution `code_update` frame): the model call is seconds-long and the host
	// should see that work instead of a silent gap.
	const [pendingEvolution, setPendingEvolution] = useState(false)

	const playerRef = useRef<StrudelPlayerRef | null>(null)
	const seededRef = useRef(false)
	const appliedCodeRef = useRef<string | null>(null)
	const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	// Monotonic badge tokens, and the token reserved by an Undo click so the
	// undo's own `code_update` frame shares it (see `frontend/lib/apply-status`).
	const applySeqRef = useRef(0)
	const pendingUndoSeqRef = useRef<number | null>(null)

	const startRoom = useMutation(trpc.rooms.start.mutationOptions())
	const undoChange = useMutation(trpc.rooms.undo.mutationOptions())
	const skipPoll = useMutation(trpc.rooms.skip.mutationOptions())
	const endRoom = useMutation(trpc.rooms.end.mutationOptions())
	const reportApplyResult = useMutation(
		trpc.rooms.reportApplyResult.mutationOptions(),
	)

	const refetchRoom = roomQuery.refetch

	const dispatchApplyStatus = useCallback((fact: ApplyStatusFact) => {
		setApplyStatusState((state) => reduceApplyStatus(state, fact))
	}, [])

	/**
	 * Claim the next badge token. Every operation that may write the badge calls
	 * this when it starts, so a result that completes out of order is rejected as
	 * superseded instead of overwriting the newer operation's badge.
	 */
	const beginApplyOperation = useCallback((): number => {
		applySeqRef.current += 1
		const seq = applySeqRef.current
		setApplyStatusState((state) =>
			reduceApplyStatus(state, { type: 'start', seq }),
		)
		return seq
	}, [])

	const showToast = useCallback((message: string) => {
		setToast(message)
		if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
		toastTimerRef.current = setTimeout(() => {
			toastTimerRef.current = null
			setToast(null)
		}, 6000)
	}, [])

	useEffect(() => {
		return () => {
			if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
		}
	}, [])

	// Seed apply: the player receives the room's current code once. Later
	// updates arrive as `code_update` events and go through the ref so the
	// matching versionId can be reported back to the server.
	const currentCode = room?.currentCode ?? null
	useEffect(() => {
		if (currentCode === null) return
		setDisplayCode(currentCode)
		if (seededRef.current) return
		if (appliedCodeRef.current === currentCode) return
		seededRef.current = true
		appliedCodeRef.current = currentCode
		setPlayerCode(currentCode)
	}, [currentCode])

	// The server stops publishing code once the outro finishes, so the host
	// browser has to hush the engine itself. Keyed on the status string so it
	// runs exactly once per transition into `ended` (idempotent across refetches).
	const roomStatus = room?.status
	useEffect(() => {
		if (roomStatus !== 'ended') return
		playerRef.current?.stop()
	}, [roomStatus])

	// Seed and reconnect applies are already-applied server versions; there is
	// no candidate to report. Only surface audible failures.
	const handlePlayerResult = useCallback(
		(result: ApplyResult) => {
			if (!result.ok) showToast(`Audio error: ${result.error}`)
		},
		[showToast],
	)

	const reportApply = useCallback(
		(event: CodeUpdateEvent, result: ApplyResult) => {
			// `initial` and `undo` versions are already marked applied server-side;
			// reportApplyResult only accepts candidates.
			if (event.kind !== 'evolution' && event.kind !== 'outro') return
			reportApplyResult.mutate(
				{
					roomId,
					versionId: event.versionId,
					ok: result.ok,
					error: result.ok ? undefined : result.error,
				},
				{
					onError: (error) => {
						showToast(`Change not confirmed: ${error.message}`)
					},
				},
			)
		},
		[reportApplyResult, roomId, showToast],
	)

	/**
	 * Resolve the badge token for an incoming `code_update`. The undo frame
	 * belongs to the Undo click that is already in flight, so it reuses the token
	 * that click reserved; any other frame claims a fresh one.
	 */
	const claimSeqForFrame = useCallback(
		(kind: CodeUpdateEvent['kind']): number => {
			if (kind !== 'undo') return beginApplyOperation()
			const reserved = pendingUndoSeqRef.current
			if (reserved === null) return beginApplyOperation()
			pendingUndoSeqRef.current = null
			return reserved
		},
		[beginApplyOperation],
	)

	const handleCodeUpdate = useCallback(
		(event: CodeUpdateEvent) => {
			const player = playerRef.current
			if (!player) return
			// Start publishes `initial` while the seed effect may already be
			// applying the same code from the refetched room; skip the duplicate.
			if (event.kind === 'initial' && appliedCodeRef.current === event.code) {
				return
			}
			appliedCodeRef.current = event.code
			const seq = claimSeqForFrame(event.kind)
			// The host asked for this revert, so its outcome is `reverted` whichever
			// writer reports it (the undo frame or the mutation response).
			const successFact: ApplyStatusFact =
				event.kind === 'undo'
					? { type: 'reverted', seq }
					: { type: 'applied', seq }
			void player.applyPattern(event.code).then((result) => {
				if (result.ok) {
					setDisplayCode(event.code)
					dispatchApplyStatus(successFact)
				} else {
					dispatchApplyStatus({
						type: 'failed',
						seq,
						error: result.error,
					})
				}
				reportApply(event, result)
			})
		},
		[claimSeqForFrame, dispatchApplyStatus, reportApply],
	)

	const handleEvent = useCallback(
		(event: WsEvent) => {
			switch (event.type) {
				case 'code_update':
					setPendingEvolution(false)
					handleCodeUpdate(event)
					break
				case 'vote_count':
					setVoteTally({ pollId: event.pollId, counts: event.counts })
					break
				case 'poll_opened':
					// A follow-up poll is up, so nothing is being generated anymore.
					setPendingEvolution(false)
					// Refetch rather than using the payload: the event carries option
					// labels (no keys) and no zero-filled counts, and a poll that opens
					// with zero votes must still show up on the console.
					void refetchRoom()
					break
				case 'poll_closed': {
					// A winning evolution vote starts backend model work; the frame
					// (or the warning toast) clears the wait. `winningOption` is an
					// option key: `yes`/`no` marks an evolution poll, `wrap`/`continue`
					// an end poll, and a skipped/overdue close has no winner — none of
					// those generate a pattern, so no indicator for them.
					const { winningOption } = event
					setPendingEvolution(
						winningOption !== null &&
							winningOption !== 'continue' &&
							winningOption !== 'wrap',
					)
					// Refetch rather than using the payload: the event carries option
					// labels (no keys) and no zero-filled counts, and a poll that opens
					// with zero votes must still show up on the console.
					void refetchRoom()
					break
				}
				case 'warning':
					setPendingEvolution(false)
					showToast(event.message)
					break
				case 'pattern_rejected':
					// Backstop for a rejected apply the browser could not confirm; it
					// belongs to the newest operation.
					dispatchApplyStatus({
						type: 'failed',
						seq: applySeqRef.current,
						error: event.error,
					})
					break
				case 'room_status':
					setPendingEvolution(false)
					void refetchRoom()
					break
				default:
					break
			}
		},
		[dispatchApplyStatus, handleCodeUpdate, refetchRoom, showToast],
	)

	// Spec "Host WS drop": the browser is the audio engine, so a dropped socket
	// means playback may have stopped. Refetch the server truth and re-apply.
	const handleReconnect = useCallback(() => {
		// No way to learn whether a generation was mid-flight while offline; a
		// stale indicator is worse than a missed one, so drop it on resync.
		setPendingEvolution(false)
		void (async () => {
			try {
				const fresh = await queryClient.fetchQuery(
					trpc.rooms.get.queryOptions({ roomId }),
				)
				const code = fresh.room.currentCode
				if (code === null) return
				appliedCodeRef.current = code
				setDisplayCode(code)
				const result = await playerRef.current?.applyPattern(code)
				if (result && !result.ok) showToast(`Audio error: ${result.error}`)
			} catch (error) {
				showToast(
					error instanceof Error
						? error.message
						: 'Resync after reconnect failed',
				)
			}
		})()
	}, [queryClient, roomId, showToast, trpc])

	const { connected } = useRoomChannel(roomId, {
		onEvent: handleEvent,
		onReconnect: handleReconnect,
	})

	const voteUrl =
		typeof window === 'undefined' ? '' : `${window.location.origin}/r/${roomId}`
	const pollOptions = openPoll?.options ?? []
	const counts =
		voteTally && voteTally.pollId === openPoll?.id
			? voteTally.counts
			: (serverCounts ?? {})
	const mutationError =
		startRoom.error ??
		undoChange.error ??
		skipPoll.error ??
		endRoom.error ??
		reportApplyResult.error

	const mutationOptionsFor = (refetchAfter = true) => ({
		onSuccess: () => {
			if (refetchAfter) void refetchRoom()
		},
	})

	if (roomQuery.isPending) {
		return (
			<AppLayout>
				<span className="loading loading-spinner" />
			</AppLayout>
		)
	}

	if (roomQuery.error || !room) {
		return (
			<AppLayout>
				<div className="alert alert-error max-w-md">
					<span>{roomQuery.error?.message ?? 'Room not found'}</span>
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => void refetchRoom()}
					>
						Retry
					</button>
				</div>
			</AppLayout>
		)
	}

	return (
		<AppLayout>
			<div className="flex max-w-3xl flex-col gap-6">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="flex flex-col gap-1">
						<span className="eyebrow">host console</span>
						<h1 className="font-bold text-2xl">
							{room.genre} · {room.bpm} BPM
						</h1>
						<p className="text-sm opacity-70">
							{Math.round(room.lengthSec / 60)} min · poll every{' '}
							{room.pollIntervalSec}s · {room.pollOpenSec}s to vote
						</p>
					</div>
					<div className="flex items-center gap-2">
						<span
							className={`badge ${connected ? 'badge-success' : 'badge-error'}`}
							data-testid="ws-status"
						>
							{connected ? 'connected' : 'reconnecting'}
						</span>
						<span className="badge badge-ghost" data-testid="room-status">
							{room.status}
						</span>
					</div>
				</div>

				{room.status === 'ended' ? (
					<div className="alert" data-testid="room-ended">
						<span>Set finished — playback stopped.</span>
						<a className="btn btn-sm" href={`/r/${roomId}`}>
							Open summary
						</a>
					</div>
				) : null}

				{room.status === 'outro' ? (
					<div className="alert">
						<span>Outro playing — the room ends after the outro bar.</span>
					</div>
				) : null}

				<div className="card bg-base-200">
					<div className="card-body flex-row flex-wrap items-center gap-6">
						<QrCode
							value={voteUrl}
							size={200}
							className="rounded-box bg-white p-2"
						/>
						<div className="flex min-w-48 flex-col gap-1">
							<span className="eyebrow">audience</span>
							<p className="text-sm opacity-80">
								Scan to vote. One vote per phone per poll.
							</p>
							<code className="break-all text-xs" data-testid="vote-url">
								{voteUrl}
							</code>
						</div>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{room.status === 'lobby' ? (
						<button
							type="button"
							className="btn btn-primary"
							data-testid="start-room"
							disabled={startRoom.isPending}
							onClick={() => {
								startRoom.mutate({ roomId }, mutationOptionsFor())
							}}
						>
							{startRoom.isPending ? (
								<span className="flex items-center gap-2">
									<span className="loading loading-spinner loading-sm" />
									Starting set…
								</span>
							) : (
								'Start set'
							)}
						</button>
					) : null}

					{room.status === 'live' || room.status === 'outro' ? (
						<>
							<button
								type="button"
								className="btn"
								data-testid="undo"
								disabled={undoChange.isPending}
								onClick={() => {
									// Reserve the badge token before the request goes out: the undo
									// frame arrives on the socket and reuses it, so the frame and the
									// mutation response always agree on the outcome.
									const seq = beginApplyOperation()
									pendingUndoSeqRef.current = seq
									undoChange.mutate(
										{ roomId },
										{
											onSuccess: () => {
												dispatchApplyStatus({ type: 'reverted', seq })
												void refetchRoom()
											},
											onError: () => {
												// No undo happened, so no frame will claim the token.
												pendingUndoSeqRef.current = null
											},
										},
									)
								}}
							>
								Undo last change
							</button>
							<button
								type="button"
								className="btn"
								data-testid="skip-poll"
								disabled={skipPoll.isPending}
								onClick={() => {
									skipPoll.mutate(
										{ roomId },
										{
											onSuccess: () => {
												showToast('Poll skipped')
												void refetchRoom()
											},
										},
									)
								}}
							>
								Skip poll
							</button>
						</>
					) : null}

					{pendingEvolution ? (
						<span className="badge badge-ghost" data-testid="evolution-pending">
							<span className="loading loading-spinner" />
							Applying poll result…
						</span>
					) : null}

					{room.status !== 'ended' ? (
						<button
							type="button"
							className="btn btn-error"
							data-testid="end-room"
							disabled={endRoom.isPending}
							onClick={() => {
								endRoom.mutate({ roomId }, mutationOptionsFor())
							}}
						>
							End set
						</button>
					) : null}
				</div>

				<p className="text-xs opacity-60">
					Click anywhere to unlock audio — browsers never resume audio from
					keyboard-only activation.
				</p>

				{applyStatusState.status ? (
					<span
						className={`badge ${APPLY_STATUS_CLASS[applyStatusState.status.tone]}`}
						data-testid="apply-status"
					>
						{applyStatusState.status.text}
					</span>
				) : null}

				{mutationError ? (
					<div className="alert alert-error" data-testid="control-error">
						{mutationError.message}
					</div>
				) : null}

				{openPoll && pollOptions.length > 0 ? (
					<PollMonitor
						question={openPoll.question}
						options={pollOptions}
						counts={counts}
					/>
				) : null}

				<details className="collapse-arrow collapse bg-base-200">
					<summary className="collapse-title font-medium">
						Current pattern
					</summary>
					<pre
						className="collapse-content overflow-x-auto text-xs"
						data-testid="current-code"
					>
						{displayCode ?? '—'}
					</pre>
				</details>
			</div>

			<StrudelPlayer
				ref={playerRef}
				code={playerCode}
				onApplyResult={handlePlayerResult}
			/>

			{toast ? (
				<div className="toast toast-end z-50">
					<div className="alert alert-warning" data-testid="toast">
						{toast}
					</div>
				</div>
			) : null}
		</AppLayout>
	)
}
