import { toDataURL } from 'qrcode'
import { useEffect, useState } from 'react'

const resolved = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

/**
 * Encode `value` as a PNG data URL. Results are memoized per value so a host
 * page that refetches room state does not re-render the QR image each time.
 */
export function qrDataUrl(value: string): Promise<string> {
	const cached = resolved.get(value)
	if (cached) return Promise.resolve(cached)

	const inFlight = pending.get(value)
	if (inFlight) return inFlight

	const promise = toDataURL(value, {
		errorCorrectionLevel: 'M',
		margin: 1,
		width: 240,
	}).then((dataUrl) => {
		resolved.set(value, dataUrl)
		pending.delete(value)
		return dataUrl
	})

	pending.set(value, promise)
	return promise
}

export function QrCode({
	value,
	size = 240,
	className,
}: {
	value: string
	size?: number
	className?: string
}) {
	const [dataUrl, setDataUrl] = useState<string | null>(
		() => resolved.get(value) ?? null,
	)

	useEffect(() => {
		const cached = resolved.get(value)
		if (cached) {
			setDataUrl(cached)
			return
		}
		let cancelled = false
		void qrDataUrl(value).then(
			(next) => {
				if (!cancelled) setDataUrl(next)
			},
			() => {
				if (!cancelled) setDataUrl(null)
			},
		)
		return () => {
			cancelled = true
		}
	}, [value])

	if (!dataUrl) {
		return (
			<div
				className="skeleton rounded-box"
				style={{ width: size, height: size }}
				aria-hidden="true"
			/>
		)
	}

	return (
		<img
			src={dataUrl}
			alt={`QR code for ${value}`}
			width={size}
			height={size}
			className={className}
			data-testid="qr-code"
		/>
	)
}
