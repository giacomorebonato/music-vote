import { authClient } from '@frontend/lib/auth'
import { signInSchema, signUpSchema } from '@shared/schemas/auth'
import { useForm } from '@tanstack/react-form'
import { useState } from 'react'

export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
	const [error, setError] = useState<string | null>(null)

	const form = useForm({
		defaultValues: {
			email: '',
			password: '',
			name: '',
		} as { email: string; password: string; name?: string },
		validators: {
			onChange: mode === 'signup' ? signUpSchema : signInSchema,
		},
		onSubmit: async ({ value }) => {
			setError(null)
			const res =
				mode === 'signin'
					? await authClient.signIn.email({
							email: value.email,
							password: value.password,
						})
					: await authClient.signUp.email({
							email: value.email,
							password: value.password,
							name: value.name ?? '',
						})
			if (res.error) {
				setError(res.error.message ?? 'Authentication failed')
				return
			}
			window.location.href = '/'
		},
	})

	return (
		<form
			className="flex max-w-sm flex-col gap-2"
			onSubmit={(e) => {
				e.preventDefault()
				form.handleSubmit()
			}}
		>
			{mode === 'signup' && (
				<form.Field
					name="name"
					children={(field) => (
						<input
							className="input input-bordered w-full"
							placeholder="Name"
							value={field.state.value ?? ''}
							onBlur={field.handleBlur}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
					)}
				/>
			)}
			<form.Field
				name="email"
				children={(field) => (
					<input
						className="input input-bordered w-full"
						type="email"
						placeholder="Email"
						value={field.state.value}
						onBlur={field.handleBlur}
						onChange={(e) => field.handleChange(e.target.value)}
					/>
				)}
			/>
			<form.Field
				name="password"
				children={(field) => (
					<input
						className="input input-bordered w-full"
						type="password"
						placeholder="Password"
						value={field.state.value}
						onBlur={field.handleBlur}
						onChange={(e) => field.handleChange(e.target.value)}
					/>
				)}
			/>
			{error && <div className="text-error">{error}</div>}
			<form.Subscribe
				selector={(state) => [state.canSubmit, state.isSubmitting]}
				children={([canSubmit, isSubmitting]) => (
					<button
						className="btn btn-primary w-full"
						type="submit"
						disabled={!canSubmit || isSubmitting}
					>
						{mode === 'signin' ? 'Sign in' : 'Sign up'}
					</button>
				)}
			/>
		</form>
	)
}
