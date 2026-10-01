import { expect, test } from 'bun:test'
import { PollMonitor } from '@frontend/components/poll-monitor'
import { renderToStaticMarkup } from 'react-dom/server'

test('renders bars from the poll option keys with no yes/no hardcoding', () => {
	const markup = renderToStaticMarkup(
		<PollMonitor
			question="End the set?"
			options={[
				{ key: 'wrap', label: 'Wrap it up' },
				{ key: 'continue', label: 'Keep going' },
			]}
			counts={{ wrap: 3, continue: 1 }}
		/>,
	)

	expect(markup).toContain('End the set?')
	expect(markup).toContain('Wrap it up')
	expect(markup).toContain('Keep going')
	expect(markup).toContain('data-testid="poll-option-wrap"')
	expect(markup).toContain('data-testid="poll-option-continue"')
	expect(markup).toContain('>3<')
	expect(markup).toContain('>1<')
	expect(markup).not.toContain('Yes')
	expect(markup).not.toContain('No')
})

test('renders a missing count as zero', () => {
	const markup = renderToStaticMarkup(
		<PollMonitor
			question="Continue?"
			options={[{ key: 'yes', label: 'Yes' }]}
			counts={{}}
		/>,
	)
	expect(markup).toContain('>0<')
})
