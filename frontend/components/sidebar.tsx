import { authClient } from '@frontend/lib/auth'
import { Link } from '@tanstack/react-router'

const GITHUB_REPO_URL = 'https://github.com/giacomorebonato/music-vote'

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
				<div className="px-2 text-sm opacity-70">{user.email}</div>
			) : null}

			<a
				href={GITHUB_REPO_URL}
				target="_blank"
				rel="noopener noreferrer"
				className="flex w-fit items-center gap-2 px-2 pb-1 text-sm opacity-70 transition-opacity hover:opacity-100"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					fill="currentColor"
					className="h-4 w-4"
					aria-hidden="true"
				>
					<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
				</svg>
				<span>GitHub</span>
			</a>
		</div>
	)
}
