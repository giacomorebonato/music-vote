import { expect, mock, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Sidebar's session hook and router Link are stubbed so the component can be
// rendered statically; a mutable holder controls what useSession() reports.
type SessionHolder = { data: unknown }

const sessionHolder: { current: SessionHolder } = { current: { data: null } }

const FakeLink = ({
	to,
	children,
}: { to: string; children?: ReactNode } & Record<string, unknown>) => (
	<a href={to}>{children}</a>
)

mock.module('@frontend/lib/auth', () => ({
	authClient: {
		useSession: () => sessionHolder.current,
	},
}))

mock.module('@tanstack/react-router', () => ({
	Link: FakeLink,
}))

const { Sidebar } = await import('@frontend/components/sidebar')

test('shows the create link for signed-in users', () => {
	sessionHolder.current = { data: { user: { email: 'dj@example.com' } } }
	const markup = renderToStaticMarkup(<Sidebar />)
	expect(markup).toContain('Create room')
	expect(markup).toContain('href="/create"')
})

test('hides the create link for signed-out users', () => {
	sessionHolder.current = { data: null }
	const markup = renderToStaticMarkup(<Sidebar />)
	expect(markup).not.toContain('Create room')
})
