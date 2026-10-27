export type PollOption = { key: string; label: string }

/**
 * Live tally for the open poll. Rendered generically from the poll's option
 * keys: evolution polls use two generated choices, the end poll uses
 * wrap/continue.
 */
export function PollMonitor({
	question,
	options,
	counts,
}: {
	question: string
	options: PollOption[]
	counts: Record<string, number>
}) {
	const total = options.reduce(
		(sum, option) => sum + (counts[option.key] ?? 0),
		0,
	)

	return (
		<div className="card bg-base-200" data-testid="poll-monitor">
			<div className="card-body gap-3">
				<span className="eyebrow">crowd mood</span>
				<h2 className="font-semibold">{question}</h2>
				{options.map((option) => {
					const count = counts[option.key] ?? 0
					const percent = total === 0 ? 0 : Math.round((count / total) * 100)
					return (
						<div
							key={option.key}
							className="flex flex-col gap-1"
							data-testid={`poll-option-${option.key}`}
						>
							<div className="flex justify-between text-sm">
								<span>{option.label}</span>
								<span>{count}</span>
							</div>
							<progress
								aria-label={`${option.label}: ${count} answers`}
								className="progress progress-primary"
								value={percent}
								max={100}
							/>
						</div>
					)
				})}
			</div>
		</div>
	)
}
