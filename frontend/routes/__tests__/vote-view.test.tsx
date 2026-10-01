import { expect, mock, test } from 'bun:test'
import { createClaimController, VoteView } from '@frontend/routes/vote'
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

test('ended shows a summary spinner before the summary resolves', () => {
	const markup = renderToStaticMarkup(
		<VoteView {...baseProps} roomStatus="ended" summaryPolls={null} />,
	)
	expect(markup).toContain('data-testid="summary-loading"')
	expect(markup).not.toContain('No polls were decided.')
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

test('re-claims a failed session claim so a lost request does not brick voting', async () => {
	const claim = mock(
		(): Promise<unknown> => Promise.reject(new Error('network down')),
	)
	const controller = createClaimController(claim)

	await expect(controller.ensure()).rejects.toThrow('network down')
	expect(claim).toHaveBeenCalledTimes(1)

	// The next attempt must really call claim() again, not reuse the dead promise.
	claim.mockImplementationOnce(() => Promise.resolve({ token: 'session' }))
	await controller.ensure()
	expect(claim).toHaveBeenCalledTimes(2)
})

test('a successful claim is reused across votes', async () => {
	const claim = mock(
		(): Promise<unknown> => Promise.resolve({ token: 'session' }),
	)
	const controller = createClaimController(claim)

	await controller.ensure()
	await controller.ensure()
	expect(claim).toHaveBeenCalledTimes(1)
})
