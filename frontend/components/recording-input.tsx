import { useEffect, useRef, useState } from 'react'
import type { SamplePlayback } from '@shared/schemas/contributions'

export function RecordingInput({
	roomId,
	disabled,
	ensure,
	onChanged,
}: {
	roomId: string
	disabled: boolean
	ensure: () => Promise<void>
	onChanged: () => void
}) {
	const [requesting, setRequesting] = useState(false)
	const [recording, setRecording] = useState(false)
	const [blob, setBlob] = useState<Blob | null>(null)
	const [url, setUrl] = useState<string | null>(null)
	const [use, setUse] = useState<SamplePlayback['use']>('percussion')
	const [error, setError] = useState<string | null>(null)
	const [trimStart, setTrimStart] = useState(0)
	const [trimEnd, setTrimEnd] = useState(3)
	const [sending, setSending] = useState(false)
	const stream = useRef<MediaStream | null>(null)
	const recorder = useRef<MediaRecorder | null>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const request = useRef(crypto.randomUUID())
	const captureAttempt = useRef(0)
	const disabledRef = useRef(disabled)
	disabledRef.current = disabled
	const mounted = useRef(true)
	function stop() {
		captureAttempt.current++
		if (mounted.current) setRequesting(false)
		if (timer.current) clearTimeout(timer.current)
		if (recorder.current?.state === 'recording') recorder.current.stop()
		stream.current?.getTracks().forEach((t) => t.stop())
		stream.current = null
		if (mounted.current) setRecording(false)
	}
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			stop()
		}
	}, [])
	useEffect(() => {
		if (disabled) stop()
	}, [disabled])
	useEffect(() => {
		if (!blob) {
			setUrl(null)
			return
		}
		const next = URL.createObjectURL(blob)
		setUrl(next)
		return () => URL.revokeObjectURL(next)
	}, [blob])
	async function start() {
		const attempt = ++captureAttempt.current
		setRequesting(true)
		setError(null)
		try {
			if (
				!navigator.mediaDevices?.getUserMedia ||
				typeof MediaRecorder === 'undefined'
			)
				throw new Error(
					'Recording needs microphone access in a supported browser over HTTPS.',
				)
			const captured = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: false,
				},
			})
			if (
				!mounted.current ||
				disabledRef.current ||
				attempt !== captureAttempt.current
			) {
				captured.getTracks().forEach((t) => t.stop())
				return
			}
			stream.current = captured
			const mimeType = [
				'audio/webm;codecs=opus',
				'audio/mp4',
				'audio/ogg;codecs=opus',
			].find((t) => MediaRecorder.isTypeSupported(t))
			const next = new MediaRecorder(
				captured,
				mimeType ? { mimeType } : undefined,
			)
			recorder.current = next
			const chunks: BlobPart[] = []
			next.ondataavailable = (e) => {
				if (e.data.size) chunks.push(e.data)
			}
			next.onerror = () => {
				if (mounted.current) setError('Recording failed. Try again.')
				stop()
			}
			next.onstop = () => {
				if (mounted.current && chunks.length) {
					setBlob(new Blob(chunks, { type: next.mimeType }))
					request.current = crypto.randomUUID()
					setTrimStart(0)
					setTrimEnd(3)
				}
			}
			setBlob(null)
			setRequesting(false)
			setRecording(true)
			next.start()
			timer.current = setTimeout(stop, 2900)
		} catch (e) {
			stop()
			setError(
				e instanceof Error
					? e.message
					: 'Microphone unavailable. You can still use the music controls.',
			)
		}
	}
	async function send() {
		if (!blob) return
		setSending(true)
		setError(null)
		try {
			await ensure()
			const response = await fetch(
				`/api/recordings?roomId=${encodeURIComponent(roomId)}&use=${use}&trimStart=${trimStart}&trimEnd=${trimEnd}`,
				{
					method: 'POST',
					headers: {
						'content-type': blob.type,
						'idempotency-key': request.current,
					},
					body: blob,
				},
			)
			const result = (await response.json()) as { error?: string }
			if (!response.ok) throw new Error(result.error || 'Upload failed.')
			setBlob(null)
			onChanged()
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Upload failed. Try again.')
		} finally {
			setSending(false)
		}
	}
	return (
		<section
			className="card bg-base-100 shadow-xl"
			aria-label="Contribute a sound"
		>
			<div className="card-body gap-3 p-4">
				<h2 className="font-bold text-lg">Put your sound in the song</h2>
				<p className="text-sm opacity-70">
					Record a clap, beatbox, whistle or short phrase. Up to 3 seconds.
					Sending lets the room play and transform your clip for a short
					section.
				</p>
				<button
					type="button"
					className={`btn ${recording ? 'btn-error' : 'btn-outline'}`}
					disabled={disabled || sending}
					onClick={() => {
						if (recording || requesting) stop()
						else void start()
					}}
				>
					{recording
						? 'Stop recording'
						: blob
							? 'Record again'
							: 'Record a sound'}
				</button>
				{url ? (
					<audio controls src={url} aria-label="Preview your recording" />
				) : null}
				{blob ? (
					<>
						<label className="flex flex-col gap-1">
							Start at {trimStart.toFixed(1)}s
							<input
								type="range"
								className="range range-sm"
								min={0}
								max={2.8}
								step={0.1}
								value={trimStart}
								onChange={(e) => {
									setTrimStart(Math.min(Number(e.target.value), trimEnd - 0.1))
									request.current = crypto.randomUUID()
								}}
							/>
						</label>
						<label className="flex flex-col gap-1">
							End at {trimEnd.toFixed(1)}s
							<input
								type="range"
								className="range range-sm"
								min={0.1}
								max={3}
								step={0.1}
								value={trimEnd}
								onChange={(e) => {
									setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.1))
									request.current = crypto.randomUUID()
								}}
							/>
						</label>
						<label className="flex flex-col gap-1">
							Use my sound as
							<select
								className="select select-bordered"
								disabled={disabled || sending}
								value={use}
								onChange={(e) =>
									setUse(e.target.value as SamplePlayback['use'])
								}
							>
								<option value="percussion">Percussion</option>
								<option value="hook">Chopped hook</option>
								<option value="atmosphere">Atmosphere</option>
							</select>
						</label>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								className="btn btn-primary"
								disabled={disabled || sending}
								onClick={() => {
									void send()
								}}
							>
								{sending ? 'Sending…' : 'Send sound'}
							</button>
							<button
								type="button"
								className="btn btn-ghost"
								disabled={sending}
								onClick={() => setBlob(null)}
							>
								Discard
							</button>
						</div>
					</>
				) : null}
				{recording ? (
					<p role="status">Recording… Hold your phone close to the sound.</p>
				) : null}
				{error ? (
					<p role="alert" className="text-error">
						{error}
					</p>
				) : null}
			</div>
		</section>
	)
}
