import type { PollCardPoll, SummaryPoll } from '@frontend/components/poll-card'
import {
	formatCountdown,
	PollCard,
	PollTimeline,
} from '@frontend/components/poll-card'
import { useRoomChannel } from '@frontend/lib/room-ws'
import { useTRPC } from '@frontend/lib/trpc'
import type { WsEvent } from '@shared/realtime/events'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

type VoteSelection = { pollId: string; choice: string | null }

type LatestResult = {
	id: string
	question: string
	winnerLabel: string | null
	winnerCount: number
	total: number
	status: string
	nextPollAt?: string | null
}

export type VoteClaimController = {
	/**
	 * Resolves when the anonymous session is usable. Re-claims when the previous
	 * attempt failed, so a phone that lost the claim request can still vote.
	 */
	ensure: () => Promise<void>
}

/**
 * Tracks the one-time `mv_session` claim. The happy path claims once and every
 * later caller awaits the same promise; a failed claim is retried on the next
 * `ensure()` instead of bricking votes against a dead promise.
 */
export function createClaimController(
	claim: () => Promise<unknown>,
): VoteClaimController {
	let pending: Promise<unknown> | null = null
	let failed = false

	function attempt(): Promise<unknown> {
		failed = false
		const next = claim()
		pending = next
		// Mark the failure without leaving an unhandled rejection on the stored
		// promise; ensure() still rejects so the caller can surface the error.
		void next.catch(() => {
			failed = true
		})
		return next
	}

	return {
		async ensure(): Promise<void> {
			if (pending !== null && !failed) {
				await pending
				return
			}
			await attempt()
		},
	}
}

type VoteViewProps = {
	roomStatus: string | null
	poll: PollCardPoll | null
	selection: VoteSelection | null
	countdownSeconds: number | null
	pending: boolean
	error: string | null
	loadError: string | null
	summaryPolls: SummaryPoll[] | null
	latestResult?: LatestResult | null
	nowMs?: number
	onVote: (choice: string) => void
}

/** Anonymous vote page reached by scanning the host's QR code. */
export function VoteRoute({ roomId }: { roomId: string }) {
	const trpc = useTRPC()
	const pollQuery = useQuery(trpc.voting.currentPoll.queryOptions({ roomId }))
	const refetchPoll = pollQuery.refetch
	const roomStatus = pollQuery.data?.roomStatus ?? null
	const poll = pollQuery.data?.poll ?? null
	const latestResult = pollQuery.data?.latestResult ?? null
	const ended = roomStatus === 'ended'

	const summaryQuery = useQuery({
		...trpc.voting.summary.queryOptions({ roomId }),
		enabled: ended,
	})

	const claimSession = useMutation(trpc.voting.claimSession.mutationOptions())
	const castVote = useMutation(trpc.voting.castVote.mutationOptions())

	const [claimController] = useState(() =>
		createClaimController(() => claimSession.mutateAsync()),
	)

	const [selection, setSelection] = useState<VoteSelection | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [nowMs, setNowMs] = useState(() => Date.now())

	const reconciledRef = useRef<string | null>(null)

	// Anonymous session: claim the mv_session cookie once on mount. handleVote
	// awaits the same controller so a fast tap cannot outrun the cookie, and a
	// failed claim is retried on the next vote instead of bricking the page.
	useEffect(() => {
		void claimController
			.ensure()
			.then(() => void refetchPoll())
			.catch(() => undefined)
	}, [claimController, refetchPoll])

	// One ticker drives every countdown; cleared on unmount so navigating away
	// cannot leak an interval.
	useEffect(() => {
		const handle = setInterval(() => setNowMs(Date.now()), 1000)
		return () => clearInterval(handle)
	}, [])

	const reconcile = useCallback(() => {
		void refetchPoll()
	}, [refetchPoll])

	const handleEvent = useCallback(
		(event: WsEvent) => {
			switch (event.type) {
				// The payload carries option labels only (no keys) and no tally, so a
				// refetch of currentPoll is the source of truth after any lifecycle
				// change or room end.
				case 'poll_opened':
				case 'poll_closed':
				case 'room_ended':
				case 'music_result':
					reconcile()
					break
				default:
					break
			}
		},
		[reconcile],
	)

	// A reconnect may have missed poll lifecycle while the socket was down, so
	// resync unconditionally.
	useRoomChannel(roomId, { onEvent: handleEvent, onReconnect: reconcile })

	useEffect(() => {
		const onVisible = (): void => {
			if (document.visibilityState === 'visible') reconcile()
		}
		document.addEventListener('visibilitychange', onVisible)
		return () => document.removeEventListener('visibilitychange', onVisible)
	}, [reconcile])

	const closesAtMs = poll?.closesAt ? Date.parse(poll.closesAt) : null
	const hasDeadline = closesAtMs !== null && !Number.isNaN(closesAtMs)
	const pollExpired = hasDeadline && nowMs >= closesAtMs
	// A host `skip` publishes no poll_closed to the audience, and currentPoll can
	// return an open poll already past closesAt. Treat an expired poll as gone and
	// refetch once per poll id so the phone never sits on a dead poll.
	const activePoll = pollExpired ? null : poll
	const activePollId = activePoll?.id ?? null

	// A stale vote error (e.g. "Poll is closed") must not ride into the next
	// poll's card once the active poll changes.
	useEffect(() => {
		setError(null)
	}, [activePollId])

	useEffect(() => {
		if (!pollExpired || poll === null) return
		if (reconciledRef.current === poll.id) return
		reconciledRef.current = poll.id
		reconcile()
	}, [pollExpired, poll, reconcile])

	const handleVote = useCallback(
		async (choice: string) => {
			if (!activePoll) return
			setError(null)
			try {
				// The mount effect starts the claim; ensure() reuses a settled claim or
				// retries a failed one before the vote goes out.
				await claimController.ensure()
				await castVote.mutateAsync({ pollId: activePoll.id, choice })
				setSelection({ pollId: activePoll.id, choice })
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : 'Vote failed'
				if (message.includes('ALREADY_VOTED')) {
					// This phone already voted on this poll and cannot re-vote (the
					// server keeps no per-phone choice to re-highlight). Show counted.
					setSelection({ pollId: activePoll.id, choice: null })
					return
				}
				setError(message)
				// POLL_CLOSED / stale poll: refetch instead of trusting the dead poll.
				reconcile()
			}
		},
		[activePoll, castVote, claimController, reconcile],
	)

	let selectionForPoll: VoteSelection | null = null
	if (activePoll && pollQuery.data?.choice) {
		selectionForPoll = { pollId: activePoll.id, choice: pollQuery.data.choice }
	}
	if (selection && activePoll && selection.pollId === activePoll.id) {
		selectionForPoll = selection
	}
	const countdownSeconds = hasDeadline
		? Math.max(0, Math.ceil((closesAtMs - nowMs) / 1000))
		: null

	return (
		<VoteView
			roomStatus={roomStatus}
			poll={activePoll}
			selection={selectionForPoll}
			countdownSeconds={activePoll ? countdownSeconds : null}
			pending={castVote.isPending}
			error={error}
			loadError={pollQuery.error?.message ?? null}
			summaryPolls={
				ended && !summaryQuery.isPending
					? (summaryQuery.data?.polls ?? [])
					: null
			}
			latestResult={latestResult}
			nowMs={nowMs}
			onVote={(choice) => {
				void handleVote(choice)
			}}
		/>
	)
}

/**
 * Presentational page body. Kept separate from the data wiring so lobby /
 * waiting / poll / ended states render directly from props.
 */
export function VoteView({
	roomStatus,
	poll,
	selection,
	countdownSeconds,
	pending,
	error,
	loadError,
	summaryPolls,
	latestResult = null,
	nowMs = Date.now(),
	onVote,
}: VoteViewProps) {
	let body: ReactNode
	if (roomStatus === null) {
		body = <span className="loading loading-spinner mx-auto" />
	} else if (roomStatus === 'lobby') {
		body = (
			<WaitingStage
				testId="waiting-dj"
				title="Waiting for the DJ"
				detail="The set hasn't started yet — keep this page open."
			/>
		)
	} else if (roomStatus === 'ended') {
		body =
			summaryPolls === null ? (
				<span
					className="loading loading-spinner mx-auto"
					data-testid="summary-loading"
				/>
			) : (
				<PollTimeline polls={summaryPolls} />
			)
	} else if (roomStatus === 'outro') {
		body = (
			<WaitingStage
				testId="waiting-outro"
				title="Wrapping up"
				detail="The set is ending — no more votes."
			/>
		)
	} else if (poll) {
		body = (
			<PollCard
				question={poll.question}
				options={poll.options}
				selectedKey={selection?.choice ?? null}
				voted={selection !== null}
				countdownSeconds={countdownSeconds}
				pending={pending}
				onVote={onVote}
			/>
		)
	} else {
		body = latestResult ? (
			<ResultStage result={latestResult} nowMs={nowMs} />
		) : (
			<WaitingStage
				testId="waiting-poll"
				title="Waiting for the next poll"
				detail="A new question is coming up — vote when it appears."
			/>
		)
	}

	return (
		<div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
			<header className="flex flex-col items-center gap-1">
				<span className="eyebrow">music vote</span>
			</header>
			{loadError ? (
				<div className="alert alert-error" data-testid="vote-error">
					<span>{loadError}</span>
				</div>
			) : null}
			{error ? (
				<div className="alert alert-warning" data-testid="vote-error">
					<span>{error}</span>
				</div>
			) : null}
			{body}
		</div>
	)
}

function ResultStage({
	result,
	nowMs,
}: {
	result: LatestResult
	nowMs: number
}) {
	const percent =
		result.total === 0
			? 0
			: Math.round((result.winnerCount / result.total) * 100)
	let title =
		result.total === 0 ? 'No votes this round' : 'No majority this round'
	if (result.status === 'skipped') title = 'DJ skipped this round'
	if (result.winnerLabel) {
		title = `${result.winnerLabel} wins — ${percent}% of ${result.total} votes cast`
	}
	let detail = 'The groove continues. Keep dancing!'
	if (result.status === 'applied')
		detail = 'The crowd’s choice is playing. Back to dancing!'
	if (result.status === 'failed')
		detail = 'That change could not play. The groove continues.'
	if (result.status === 'preparing')
		detail = 'Getting the crowd’s choice ready. Keep dancing!'
	const nextInSeconds = result.nextPollAt
		? Math.max(0, Math.ceil((Date.parse(result.nextPollAt) - nowMs) / 1000))
		: null
	return (
		<div
			className="card bg-base-100 shadow-xl"
			data-testid="latest-result"
			aria-live="polite"
		>
			<div className="card-body gap-3 text-center">
				<span className="eyebrow">crowd decision</span>
				<h2 className="font-bold text-xl">{title}</h2>
				<p className="opacity-70">{detail}</p>
				{nextInSeconds !== null && nextInSeconds > 0 ? (
					<p className="text-sm opacity-70">
						Next vote in about {formatCountdown(nextInSeconds)}
					</p>
				) : null}
			</div>
		</div>
	)
}

function WaitingStage({
	testId,
	title,
	detail,
}: {
	testId: string
	title: string
	detail: string
}) {
	return (
		<div className="card bg-base-100 shadow-xl" data-testid={testId}>
			<div className="card-body items-center gap-2 text-center">
				<h2 className="font-bold text-xl">{title}</h2>
				<p className="text-sm opacity-70">{detail}</p>
				<span className="loading loading-dots" />
			</div>
		</div>
	)
}
