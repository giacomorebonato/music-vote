import { prepareDemoAudio } from '@frontend/audio/strudel-init'
import { useCallback, useEffect, useState } from 'react'

export function AudioReadiness() {
	const [status, setStatus] = useState('Loading demo sounds…')
	const [loading, setLoading] = useState(true)
	const [ready, setReady] = useState(false)
	const prepare = useCallback(async () => {
		setLoading(true)
		try {
			const failures = await prepareDemoAudio()
			setReady(failures.length === 0)
			setStatus(
				failures.length
					? `Sounds unavailable: ${failures.join(', ')}`
					: 'Demo sounds ready',
			)
		} catch {
			setReady(false)
			setStatus('Could not prepare audio. Check your connection and retry.')
		} finally {
			setLoading(false)
		}
	}, [])
	useEffect(() => {
		void prepare()
	}, [prepare])
	return (
		<div
			className="flex flex-wrap items-center gap-3 text-sm"
			role="status"
			data-testid="audio-readiness"
		>
			<span className={ready ? 'text-success' : 'text-warning'}>{status}</span>
			{!ready && !loading ? (
				<button
					type="button"
					className="btn btn-sm"
					onClick={() => {
						void prepare()
					}}
				>
					Retry sounds
				</button>
			) : null}
		</div>
	)
}
