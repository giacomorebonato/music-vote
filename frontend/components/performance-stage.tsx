import { subscribePlayback } from '@frontend/audio/strudel-init'
import { QrCode } from '@frontend/components/qr-code'
import { StrudelPattern } from '@frontend/components/strudel-pattern'
import type { CrowdQuestion } from '@shared/schemas/preferences'
import { getAudioContext, type Scheduler } from '@strudel/web'
import { type ReactNode, useEffect, useRef, useState } from 'react'

export function PerformanceStage({
	genre,
	bpm,
	voteUrl,
	questions,
	code,
	controls,
	onClose,
}: {
	genre: string
	bpm: number
	voteUrl: string
	questions: CrowdQuestion[]
	code: string | null
	controls: ReactNode
	onClose: () => void
}) {
	const stageRef = useRef<HTMLElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	const [showCode, setShowCode] = useState(false)
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null
		closeRef.current?.focus()
		const close = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
			if (event.key === 'Tab') {
				const buttons = stageRef.current?.querySelectorAll<HTMLButtonElement>(
					'button:not(:disabled)',
				)
				const first = buttons?.[0]
				const last = buttons?.[buttons.length - 1]
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault()
					last?.focus()
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault()
					first?.focus()
				}
			}
		}
		window.addEventListener('keydown', close)
		return () => {
			window.removeEventListener('keydown', close)
			previous?.focus()
		}
	}, [onClose])
	useEffect(() => {
		const canvas = canvasRef.current
		const ctx = canvas?.getContext('2d')
		if (!canvas || !ctx) return
		let clock: Scheduler | null = null
		let playing = false
		let frame = 0
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
		const unsubscribe = subscribePlayback((state, scheduler) => {
			clock = scheduler
			playing = state.started
		})
		const draw = () => {
			const width = canvas.clientWidth
			const height = canvas.clientHeight
			const scale = Math.min(window.devicePixelRatio, 2)
			if (canvas.width !== width * scale || canvas.height !== height * scale) {
				canvas.width = width * scale
				canvas.height = height * scale
			}
			ctx.setTransform(scale, 0, 0, scale, 0, 0)
			ctx.clearRect(0, 0, width, height)
			const time =
				playing && !reduced.matches && getAudioContext()?.state === 'running'
					? (clock?.now() ?? 0) * 4
					: 0
			const pulse = Math.exp(-((time % 1) * 5))
			for (let i = 0; i < 36; i++) {
				const angle = (i * Math.PI * 2) / 36 + time * 0.025
				const radius =
					Math.min(width, height) *
					(0.23 + 0.035 * Math.sin(time * 0.3 + i) + pulse * 0.025)
				const x = width / 2 + Math.cos(angle) * radius
				const y = height / 2 + Math.sin(angle) * radius
				ctx.beginPath()
				ctx.arc(x, y, 3 + pulse * 5 + (i % 3), 0, Math.PI * 2)
				ctx.fillStyle = `hsla(${270 + i * 3}, 90%, 70%, ${0.55 + pulse * 0.4})`
				ctx.fill()
			}
			ctx.textAlign = 'center'
			ctx.fillStyle = '#ffffff'
			ctx.font = `700 ${Math.min(width * 0.09, 100)}px 'Space Grotesk', sans-serif`
			ctx.fillText('WE ARE', width / 2, height / 2 - 8)
			ctx.fillStyle = '#f9a8d4'
			ctx.fillText('THE DJ', width / 2, height / 2 + Math.min(width * 0.1, 105))
			frame = requestAnimationFrame(draw)
		}
		draw()
		return () => {
			unsubscribe()
			cancelAnimationFrame(frame)
		}
	}, [showCode])
	return (
		<section
			ref={stageRef}
			className="performance-stage"
			role="dialog"
			aria-modal="true"
			aria-label="Live performance"
			data-testid="performance-stage"
		>
			<header className="flex flex-wrap items-center justify-between gap-4 p-5 shrink-0">
				<div>
					<p className="eyebrow">music vote · live together</p>
					<p className="font-bold text-2xl">
						{genre} / {bpm} BPM
					</p>
				</div>
				<div className="flex gap-2">
					<button
						className="btn btn-outline"
						type="button"
						onClick={() => setShowCode(!showCode)}
					>
						{showCode ? 'Hide code' : 'Reveal code'}
					</button>
					<button
						ref={closeRef}
						className="btn"
						type="button"
						onClick={onClose}
					>
						Exit performance
					</button>
				</div>
			</header>
			<div className="grid flex-1 gap-6 px-6 lg:grid-cols-[1fr_280px]">
				<div className="flex min-w-0 flex-col justify-center">
					{showCode ? (
						<StrudelPattern code={code} />
					) : (
						<canvas
							ref={canvasRef}
							className="h-[48vh] min-h-64 w-full"
							role="img"
							aria-label="Beat-synchronized dance floor"
							data-testid="dance-visual"
						/>
					)}
					<div className="grid gap-3 sm:grid-cols-3">
						{questions.map((question) => {
							const total = Object.values(question.counts).reduce(
								(a, b) => a + b,
								0,
							)
							return (
								<div
									key={question.id}
									className="rounded-2xl border border-white/15 bg-white/5 p-4"
								>
									<p className="mb-3 text-sm opacity-70">{question.question}</p>
									{question.options.map((option) => (
										<div key={option.key} className="mb-2">
											<div className="flex justify-between gap-2">
												<span>{option.label}</span>
												<span>
													{total
														? Math.round(
																((question.counts[option.key] ?? 0) / total) *
																	100,
															)
														: 0}
													%
												</span>
											</div>
											<progress
												className="progress progress-secondary h-1"
												value={question.counts[option.key] ?? 0}
												max={total || 1}
											/>
										</div>
									))}
								</div>
							)
						})}
					</div>
				</div>
				<aside className="flex flex-col items-center justify-center gap-5 pb-6 text-center">
					<QrCode
						value={voteUrl}
						size={240}
						className="max-w-full rounded-2xl bg-white p-3"
					/>
					<h2 className="text-3xl font-bold">Shape the groove.</h2>
					<p className="opacity-70">
						Scan. Pick your vibe.
						<br />
						Hear the room change.
					</p>
					<code className="break-all text-xs opacity-70">{voteUrl}</code>
				</aside>
			</div>
			<footer className="flex flex-wrap items-center justify-center gap-3 p-6 shrink-0">
				{controls}
			</footer>
		</section>
	)
}
