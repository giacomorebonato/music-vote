import { authClient } from '@frontend/lib/auth'
import { Link } from '@tanstack/react-router'

export function Sidebar() {
	const { data: session } = authClient.useSession()
	const user = session?.user
	const signedIn = Boolean(user)

	return (
		<div className="flex h-full flex-col gap-4 bg-base-200 p-4">
			<a href="/" className="flex items-center gap-2.5 px-2 pt-1">
				<span className="wordmark">
					music-vote
					<span className="wordmark-cursor" aria-hidden="true" />
				</span>
			</a>

			<ul className="menu w-full flex-1 gap-1 px-0">
				<li>
					<Link
						to="/"
						activeProps={{ className: 'menu-active' }}
						activeOptions={{ exact: true }}
					>
						Home
					</Link>
				</li>
				{signedIn ? (
					<li>
						<Link
							to="/create"
							activeProps={{ className: 'menu-active' }}
							activeOptions={{ exact: true }}
						>
							Create room
						</Link>
					</li>
				) : null}
			</ul>

			{signedIn && user?.email ? (
				<div className="px-2 pb-1 text-sm opacity-70">{user.email}</div>
			) : null}
		</div>
	)
}
