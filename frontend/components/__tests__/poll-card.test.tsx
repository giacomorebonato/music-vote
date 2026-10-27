import { expect, test } from 'bun:test'
import { PollCard } from '@frontend/components/poll-card'
import { renderToStaticMarkup } from 'react-dom/server'

const question = {
	id: 'energy',
	question: 'What energy feels right?',
	options: [
		{ key: 'mellow', label: 'Mellow' },
		{ key: 'intense', label: 'Intense' },
	],
	counts: { mellow: 1, intense: 3 },
	choice: 'mellow',
}

test('saved choices stay editable and the full distribution stays visible', () => {
	const markup = renderToStaticMarkup(
		<PollCard
			question={question}
			pending={false}
			disabled={false}
			onVote={() => {}}
		/>,
	)
	expect(markup).toContain('aria-pressed="true"')
	expect(markup).toContain('1 · 25%')
	expect(markup).toContain('3 · 75%')
	expect(markup).not.toContain('disabled=""')
	expect(markup).not.toContain('countdown')
})

test('empty questions have zero counts without invalid percentages', () => {
	const markup = renderToStaticMarkup(
		<PollCard
			question={{ ...question, counts: {}, choice: null }}
			pending={false}
			disabled={false}
			onVote={() => {}}
		/>,
	)
	expect(markup).toContain('0 answers')
	expect(markup).not.toContain('NaN')
})

test('pending saves and ended sets disable answer submission', () => {
	for (const props of [
		{ pending: true, disabled: false },
		{ pending: false, disabled: true },
	]) {
		const markup = renderToStaticMarkup(
			<PollCard question={question} {...props} onVote={() => {}} />,
		)
		expect(markup.match(/disabled=""/g)).toHaveLength(2)
	}
})
