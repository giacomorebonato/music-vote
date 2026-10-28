import { CrowdContributions } from '@frontend/components/crowd-contributions'
import type { ReactNode } from 'react'
import { PollCard } from '@frontend/components/poll-card'
import { useRoomChannel } from '@frontend/lib/room-ws'
import { useTRPC } from '@frontend/lib/trpc'
import type { WsEvent } from '@shared/realtime/events'
import type { CrowdQuestion } from '@shared/schemas/preferences'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
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

export function VoteRoute({ roomId }: { roomId: string }) {
	const trpc = useTRPC()
	const crowd = useQuery({
		...trpc.voting.crowd.queryOptions({ roomId }),
		refetchInterval: 10_000,
	})
	const refetch = crowd.refetch
	const claim = useMutation(trpc.voting.claimSession.mutationOptions())
	const answer = useMutation(trpc.voting.castVote.mutationOptions())
	const [claimController] = useState(() =>
		createClaimController(() => claim.mutateAsync()),
	)
	const [error, setError] = useState<string | null>(null)
	const reconcile = useCallback(() => {
		void refetch()
	}, [refetch])
	useEffect(() => {
		void claimController
			.ensure()
			.then(reconcile)
			.catch(() => setError('Could not connect. Tap an answer to retry.'))
	}, [claimController, reconcile])
	const handleEvent = useCallback(
		(event: WsEvent) => {
			if (
				event.type === 'crowd_changed' ||
				event.type === 'room_status' ||
				event.type === 'room_ended' ||
				event.type === 'music_result'
			)
				reconcile()
		},
		[reconcile],
	)
	useRoomChannel(roomId, { onEvent: handleEvent, onReconnect: reconcile })
	useEffect(() => {
		const visible = () => {
			if (document.visibilityState === 'visible') reconcile()
		}
		document.addEventListener('visibilitychange', visible)
		return () => document.removeEventListener('visibilitychange', visible)
	}, [reconcile])
	const onVote = async (pollId: string, choice: string | null) => {
		setError(null)
		try {
			await claimController.ensure()
			await answer.mutateAsync({ pollId, choice })
			reconcile()
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: 'Could not save your choice. Try again.',
			)
			reconcile()
		}
	}
	return (
		<VoteView
			roomStatus={crowd.data?.roomStatus ?? null}
			questions={crowd.data?.questions ?? []}
			deliveryStatus={crowd.data?.deliveryStatus ?? null}
			pendingQuestionId={answer.isPending ? answer.variables.pollId : null}
			error={error ?? crowd.error?.message ?? null}
			onVote={(pollId, choice) => {
				void onVote(pollId, choice)
			}}
		>
			<CrowdContributions
				roomId={roomId}
				live={crowd.data?.roomStatus === 'live'}
				ensure={claimController.ensure}
			/>
		</VoteView>
	)
}

export function VoteView({
	children,
	roomStatus,
	questions,
	deliveryStatus,
	pendingQuestionId,
	error,
	onVote,
}: {
	children?: ReactNode
	roomStatus: string | null
	questions: CrowdQuestion[]
	deliveryStatus: string | null
	pendingQuestionId: string | null
	error: string | null
	onVote: (pollId: string, choice: string | null) => void
}) {
	const live = roomStatus === 'live'
	const deliveryCopy =
		deliveryStatus === 'preparing'
			? 'The music is taking in the room’s mood.'
			: deliveryStatus === 'applied'
				? 'The music has evolved with the crowd.'
				: deliveryStatus === 'failed'
					? 'The groove continues. That update could not play.'
					: deliveryStatus === 'unchanged'
						? 'The groove feels right. Let it ride.'
						: null
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 px-4 py-6">
			<header className="flex flex-col gap-2 text-center">
				<span className="eyebrow">music vote</span>
				<h1 className="font-bold text-2xl">
					{roomStatus === 'ended'
						? 'Thanks for the dance'
						: 'What’s your vibe?'}
				</h1>
				<p className="text-sm opacity-70">
					{live
						? 'Pick any answers. Change your mind anytime.'
						: roomStatus === 'ended'
							? 'Here’s how the room felt.'
							: 'The room’s mood, all in one place.'}
				</p>
				<p className="text-xs opacity-60">Live crowd mood · just for fun</p>
			</header>
			{error ? (
				<div
					className="alert alert-warning"
					role="alert"
					data-testid="vote-error"
				>
					{error}
				</div>
			) : null}
			{roomStatus === null && !error ? (
				<span className="loading loading-spinner mx-auto" />
			) : null}
			{roomStatus === 'lobby' ? (
				<p className="text-center" data-testid="waiting-dj">
					Waiting for the DJ. Come back whenever you like.
				</p>
			) : null}
			{roomStatus === 'outro' ? (
				<p className="text-center">Wrapping up — enjoy the last groove.</p>
			) : null}
			{live && questions.length === 0 ? (
				<p className="text-center">Getting the room ready…</p>
			) : null}
			{questions.map((question) => (
				<PollCard
					key={question.id}
					question={question}
					pending={pendingQuestionId === question.id}
					disabled={!live}
					onVote={(choice) => onVote(question.id, choice)}
				/>
			))}
			{children}
			{live && deliveryCopy ? (
				<p
					className="text-center text-sm opacity-70"
					data-testid="music-delivery"
				>
					{deliveryCopy}
				</p>
			) : null}
		</main>
	)
}
