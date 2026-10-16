export type PollOption = { key: string; label: string }

export type PollCardPoll = {
	id: string
	question: string
	options: PollOption[]
	closesAt: string | null
}

export type SummaryPoll = {
	question: string
	winningOption: string | null
	winningLabel?: string | null
	deliveryStatus?: string | null
	applied: boolean
	reverted?: boolean
}

function summaryOutcome(poll: SummaryPoll): string | null {
	if (poll.applied) return 'music changed'
	if (poll.reverted) return 'later undone'
	if (poll.deliveryStatus === 'unchanged') return 'groove stayed'
	if (poll.deliveryStatus === 'failed') return 'change could not play'
	return null
}

/** Seconds remaining rendered as `m:ss`, clamped at zero. */
export function formatCountdown(totalSeconds: number): string {
	const clamped = Math.max(0, Math.floor(totalSeconds))
	const minutes = Math.floor(clamped / 60)
	const seconds = clamped % 60
	return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * The single poll a phone shows at a time. Buttons are rendered from the
 * poll's own option keys — evolution polls use two generated choices, while
 * the end poll uses wrap/continue — so nothing here hardcodes option names.
 *
 * Fully prop-driven: the parent owns the vote outcome, which keeps both the
 * pre-vote and voted states directly renderable in a static test.
 */
export function PollCard({
	question,
	options,
	selectedKey,
	voted,
	countdownSeconds,
	pending,
	onVote,
}: {
	question: string
	options: PollOption[]
	selectedKey: string | null
	voted: boolean
	countdownSeconds: number | null
	pending: boolean
	onVote: (choice: string) => void
}) {
	return (
		<div className="card bg-base-100 shadow-xl" data-testid="poll-card">
			<div className="card-body gap-4">
				<div className="flex items-center justify-between">
					<span className="eyebrow">vote now</span>
					{countdownSeconds === null ? null : (
						<span className="badge badge-neutral" data-testid="poll-countdown">
							{formatCountdown(countdownSeconds)}
						</span>
					)}
				</div>
				<h2 className="font-bold text-xl" data-testid="poll-question">
					{question}
				</h2>
				<div className="flex flex-col gap-3">
					{options.map((option) => (
						<button
							key={option.key}
							type="button"
							className={`btn btn-lg ${
								selectedKey === option.key ? 'btn-success' : 'btn-primary'
							}`}
							data-testid={`vote-option-${option.key}`}
							disabled={voted || pending}
							onClick={() => onVote(option.key)}
						>
							{option.label}
						</button>
					))}
				</div>
				{voted ? (
					<div className="alert alert-success" data-testid="vote-counted">
						<span>Vote counted. Back to dancing!</span>
					</div>
				) : null}
			</div>
		</div>
	)
}

/**
 * Ended screen: the timeline of every poll that actually shaped the set.
 *
 * `voting.summary` returns a superset — queued/open polls and polls whose
 * `winningOption` is null (zero votes or a tie) never changed the music, so
 * they are filtered out here rather than rendered.
 */
export function PollTimeline({ polls }: { polls: SummaryPoll[] }) {
	const decided = polls.filter((poll) => poll.winningOption !== null)

	return (
		<div className="flex flex-col gap-4" data-testid="poll-timeline">
			<h2 className="font-bold text-2xl">Set summary</h2>
			{decided.length === 0 ? (
				<p className="opacity-70" data-testid="timeline-empty">
					No polls were decided.
				</p>
			) : (
				<ol className="flex flex-col gap-3">
					{decided.map((poll) => (
						<li
							key={`${poll.question}|${poll.winningOption}|${poll.applied}`}
							className="card bg-base-200"
							data-testid="timeline-item"
						>
							<div className="card-body gap-1">
								<span className="text-sm opacity-70">poll</span>
								<span className="font-medium">{poll.question}</span>
								<div className="flex items-center gap-2">
									<span className="badge badge-primary">
										{poll.winningLabel ?? poll.winningOption}
									</span>
									{summaryOutcome(poll) ? (
										<span className="text-xs opacity-70">
											{summaryOutcome(poll)}
										</span>
									) : null}
								</div>
							</div>
						</li>
					))}
				</ol>
			)}
		</div>
	)
}
