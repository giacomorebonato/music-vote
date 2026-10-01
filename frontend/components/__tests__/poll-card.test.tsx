import { expect, test } from 'bun:test'
import {
	formatCountdown,
	PollCard,
	PollTimeline,
} from '@frontend/components/poll-card'
import { renderToStaticMarkup } from 'react-dom/server'

const noop = () => {}

function countDisabled(markup: string): number {
	return markup.match(/disabled=""/g)?.length ?? 0
}

test('renders the question and one button per option, never hardcoding yes/no', () => {
	const markup = renderToStaticMarkup(
		<PollCard
			question="End the set?"
			options={[
				{ key: 'wrap', label: 'Wrap it up' },
				{ key: 'continue', label: 'Keep going' },
			]}
			selectedKey={null}
			voted={false}
			countdownSeconds={75}
			pending={false}
			onVote={noop}
		/>,
	)

	expect(markup).toContain('End the set?')
	expect(markup).toContain('Wrap it up')
	expect(markup).toContain('Keep going')
	expect(markup).toContain('data-testid="vote-option-wrap"')
	expect(markup).toContain('data-testid="vote-option-continue"')
	expect(markup).toContain('1:15')
	expect(markup).not.toContain('data-testid="vote-counted"')
	expect(countDisabled(markup)).toBe(0)
})

test('disables the buttons and shows "Vote counted" after voting', () => {
	const markup = renderToStaticMarkup(
		<PollCard
			question="More energy?"
			options={[
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			]}
			selectedKey="yes"
			voted={true}
			countdownSeconds={10}
			pending={false}
			onVote={noop}
		/>,
	)

	expect(markup).toContain('data-testid="vote-counted"')
	expect(markup).toContain('Vote counted')
	// Both option buttons are disabled once the vote is recorded.
	expect(countDisabled(markup)).toBe(2)
})

test('formats the countdown as m:ss, clamped at zero', () => {
	expect(formatCountdown(75)).toBe('1:15')
	expect(formatCountdown(5)).toBe('0:05')
	expect(formatCountdown(0)).toBe('0:00')
	expect(formatCountdown(-3)).toBe('0:00')
	expect(formatCountdown(125)).toBe('2:05')
})

test('ended timeline lists only decided polls', () => {
	const markup = renderToStaticMarkup(
		<PollTimeline
			polls={[
				{ question: 'More energy?', winningOption: 'yes', applied: true },
				{ question: 'Zero votes?', winningOption: null, applied: false },
				{ question: 'End the set?', winningOption: 'continue', applied: false },
			]}
		/>,
	)

	expect(markup).toContain('Set summary')
	expect(markup).toContain('More energy?')
	expect(markup).toContain('End the set?')
	expect(markup).toContain('yes')
	expect(markup).toContain('continue')
	expect(markup).not.toContain('Zero votes?')
})
