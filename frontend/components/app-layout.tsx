import { Sidebar } from '@frontend/components/sidebar'
import { authClient } from '@frontend/lib/auth'
import { isBareRoute } from '@frontend/lib/layout'
import { Link, useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function AppLayout({
	children,
	actions,
}: {
	children: ReactNode
	actions?: ReactNode
}) {
	const { pathname } = useLocation()
	const bare = isBareRoute(pathname)
	const { data: session } = authClient.useSession()
	const signedIn = Boolean(session?.user)

	return (
		<div className="drawer lg:drawer-open">
			<input id="app-drawer" type="checkbox" className="drawer-toggle" />

			<div className="drawer-content flex min-h-screen flex-col">
				<header className="app-bar sticky top-0 z-10">
					<div className="flex h-14 w-full items-center justify-between px-4">
						<div className="flex items-center gap-2">
							{bare ? null : (
								<label
									htmlFor="app-drawer"
									className="btn btn-ghost btn-square lg:hidden"
									aria-label="Open navigation"
									data-testid="drawer-open"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										className="h-5 w-5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<title>Toggle sidebar</title>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M4 6h16M4 12h16M4 18h16"
										/>
									</svg>
								</label>
							)}
						</div>
						<div className="flex items-center gap-2">
							{actions ??
								(!bare && !signedIn ? (
									<Link to="/login" className="btn btn-ghost btn-sm">
										Sign in
									</Link>
								) : null)}
						</div>
					</div>
				</header>

				<main className="flex-1 px-6 py-8">{children}</main>
			</div>

			{bare ? null : (
				<div className="drawer-side z-20">
					<label
						htmlFor="app-drawer"
						aria-label="close sidebar"
						data-testid="drawer-close"
						className="drawer-overlay"
					/>
					<div className="h-dvh w-64">
						<Sidebar />
					</div>
				</div>
			)}
		</div>
	)
}
