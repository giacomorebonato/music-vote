import { expect, mock, test } from 'bun:test'
import { createClaimController, VoteView } from '@frontend/routes/vote'
import { preferenceQuestions } from '@shared/schemas/preferences'
import { renderToStaticMarkup } from 'react-dom/server'

const baseProps = {
	questions: preferenceQuestions.map((question, index) => ({
		...question,
		id: String(index),
		counts: {},
		choice: null,
	})),
	deliveryStatus: null,
	pendingQuestionId: null,
	error: null,
	onVote: () => {},
}
test('all questions stay present while generation is pending', () => {
	const markup = renderToStaticMarkup(
		<VoteView {...baseProps} roomStatus="live" deliveryStatus="preparing" />,
	)
	expect(markup.match(/data-testid="preference-question"/g)).toHaveLength(3)
	expect(markup).toContain('Change your mind anytime')
	expect(markup).not.toContain('disabled=""')
	expect(markup).not.toContain('countdown')
	expect(markup).not.toContain('wins')
})
test('lobby invites people to return without watching a timer', () => {
	const markup = renderToStaticMarkup(
		<VoteView {...baseProps} questions={[]} roomStatus="lobby" />,
	)
	expect(markup).toContain('Waiting for the DJ')
	expect(markup).toContain('Come back whenever you like')
})
test('ended shows the crowd distribution with no winner or interactive controls', () => {
	const markup = renderToStaticMarkup(
		<VoteView {...baseProps} roomStatus="ended" />,
	)
	expect(markup).toContain('Thanks for the dance')
	expect(markup.match(/disabled=""/g)).toHaveLength(9)
	expect(markup).not.toContain('wins')
})
test('failed generation does not claim a musical change played', () => {
	const markup = renderToStaticMarkup(
		<VoteView {...baseProps} roomStatus="live" deliveryStatus="failed" />,
	)
	expect(markup).toContain('That update could not play')
	expect(markup).not.toContain('has evolved')
})
test('re-claims a failed session claim so a lost request does not brick voting', async () => {
	const claim = mock((): Promise<unknown> =>
		Promise.reject(new Error('network down')),
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
	const claim = mock((): Promise<unknown> =>
		Promise.resolve({ token: 'session' }),
	)
	const controller = createClaimController(claim)

	await controller.ensure()
	await controller.ensure()
	expect(claim).toHaveBeenCalledTimes(1)
})
