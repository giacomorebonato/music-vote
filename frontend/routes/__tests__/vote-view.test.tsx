import { expect, test } from 'bun:test'
import { VoteView } from '@frontend/routes/vote'
import { renderToStaticMarkup } from 'react-dom/server'

const noop = () => {}

const baseProps = {
	poll: null,
	selection: null,
	countdownSeconds: null,
	pending: false,
	error: null,
	loadError: null,
	summaryPolls: null,
	onVote: noop,
}

test('lobby shows the waiting-for-the-DJ copy', () => {
	const markup = renderToStaticMarkup(
		<VoteView {...baseProps} roomStatus="lobby" />,
	)
	expect(markup).toContain('Waiting for the DJ')
	expect(markup).not.toContain('data-testid="poll-card"')
})

test('ended renders the summary timeline, filtering undecided polls', () => {
	const markup = renderToStaticMarkup(
		<VoteView
			{...baseProps}
			roomStatus="ended"
			summaryPolls={[
				{ question: 'More energy?', winningOption: 'yes', applied: true },
				{ question: 'Undecided?', winningOption: null, applied: false },
			]}
		/>,
	)
	expect(markup).toContain('Set summary')
	expect(markup).toContain('More energy?')
	expect(markup).not.toContain('Undecided?')
})

test('live with an open poll renders the vote card', () => {
	const markup = renderToStaticMarkup(
		<VoteView
			{...baseProps}
			roomStatus="live"
			poll={{
				id: 'poll-1',
				question: 'More energy?',
				options: [
					{ key: 'yes', label: 'Yes' },
					{ key: 'no', label: 'No' },
				],
				closesAt: '2026-10-01T00:00:00.000Z',
			}}
			countdownSeconds={42}
		/>,
	)
	expect(markup).toContain('data-testid="poll-card"')
	expect(markup).toContain('More energy?')
	expect(markup).toContain('0:42')
})

test('live with no open poll shows the next-poll wait', () => {
	const markup = renderToStaticMarkup(
		<VoteView {...baseProps} roomStatus="live" />,
	)
	expect(markup).toContain('Waiting for the next poll')
})
