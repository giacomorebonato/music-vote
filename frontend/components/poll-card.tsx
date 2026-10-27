import type { CrowdQuestion } from '@shared/schemas/preferences'

/** One persistent question. Counts are a playful view of the whole crowd. */
export function PollCard({
	question,
	pending,
	disabled,
	onVote,
}: {
	question: CrowdQuestion
	pending: boolean
	disabled: boolean
	onVote: (choice: string) => void
}) {
	const total = Object.values(question.counts).reduce(
		(sum, count) => sum + count,
		0,
	)
	return (
		<section
			className="card bg-base-100 shadow-xl"
			data-testid="preference-question"
			aria-label={question.question}
		>
			<div className="card-body gap-3 p-4">
				<h2 className="font-bold text-lg">{question.question}</h2>
				<div className="grid grid-cols-3 gap-2">
					{question.options.map((option) => {
						const count = question.counts[option.key] ?? 0
						const percent = total === 0 ? 0 : Math.round((count / total) * 100)
						return (
							<div key={option.key} className="flex flex-col gap-1">
								<button
									type="button"
									className={`btn h-auto min-h-16 flex-col gap-1 px-1 py-2 text-sm disabled:opacity-100 disabled:text-base-content ${question.choice === option.key ? 'btn-primary' : 'btn-outline'}`}
									aria-pressed={question.choice === option.key}
									data-testid={`vote-option-${option.key}`}
									disabled={disabled || pending}
									onClick={() => onVote(option.key)}
								>
									<span>
										{option.label}
										{question.choice === option.key ? ' ✓' : ''}
									</span>
									<span>
										{count} · {percent}%
									</span>
								</button>
								<progress
									className="progress progress-primary h-1"
									value={percent}
									max={100}
									aria-label={`${option.label}: ${count} of ${total} answers`}
								/>
							</div>
						)
					})}
				</div>
				<p className="text-xs opacity-60">
					{total} {total === 1 ? 'answer' : 'answers'}
				</p>
			</div>
		</section>
	)
}
