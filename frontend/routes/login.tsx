import { AppLayout } from '@frontend/components/app-layout'
import { AuthForm } from '@frontend/components/auth-form'
import { useState } from 'react'

export function LoginRoute() {
	const [mode, setMode] = useState<'signin' | 'signup'>('signin')
	const setSignin = (): void => setMode('signin')
	const setSignup = (): void => setMode('signup')
	return (
		<AppLayout>
			<div className="flex max-w-sm flex-col gap-6">
				<div className="flex flex-col gap-1">
					<span className="eyebrow">
						{mode === 'signin' ? 'welcome back' : 'create account'}
					</span>
					<h1 className="font-bold text-2xl">
						{mode === 'signin' ? 'Sign in' : 'Sign up'}
					</h1>
				</div>
				<div className="join">
					<button
						type="button"
						className={`btn join-item ${mode === 'signin' ? 'btn-active' : ''}`}
						onClick={setSignin}
					>
						Sign in
					</button>
					<button
						type="button"
						className={`btn join-item ${mode === 'signup' ? 'btn-active' : ''}`}
						onClick={setSignup}
					>
						Sign up
					</button>
				</div>
				<AuthForm key={mode} mode={mode} />
			</div>
		</AppLayout>
	)
}
