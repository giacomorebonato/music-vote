import { getAudioContext } from '@strudel/web'
import {
	initStrudelOnce,
	phraseAudioTime,
	waitForPhrase,
} from '@frontend/audio/strudel-init'
import {
	samplePlaybackSchema,
	type SamplePlayback,
} from '@shared/schemas/contributions'

const preparedBuffers = new Map<string, AudioBuffer>()
let activeId: string | null = null
let operation = 0
let nodes: AudioBufferSourceNode[] = []
let expiry: ReturnType<typeof setTimeout> | undefined

/** Trusted accompaniment, independent of generated code; every source has a scheduled stop. */
export function stopCrowdSample(): void {
	operation++
	clearTimeout(expiry)
	for (const node of nodes) {
		try {
			node.stop()
		} catch {
			/* already ended */
		}
		node.disconnect()
	}
	nodes = []
	activeId = null
	preparedBuffers.clear()
}
export async function prepareCrowdSample(
	sample: SamplePlayback,
): Promise<AudioBuffer> {
	samplePlaybackSchema.parse(sample)
	await initStrudelOnce()
	const cached = preparedBuffers.get(sample.id)
	if (cached) return cached
	const response = await fetch(sample.url, {
		signal: AbortSignal.timeout(10_000),
		cache: 'no-store',
	})
	if (!response.ok) throw new Error('This crowd sample is no longer available.')
	const buffer = await getAudioContext().decodeAudioData(
		await response.arrayBuffer(),
	)
	if (buffer.duration > 3.1 || buffer.duration < 0.08)
		throw new Error('This crowd sample has an invalid duration.')
	if (preparedBuffers.size >= 2) preparedBuffers.clear()
	preparedBuffers.set(sample.id, buffer)
	return buffer
}
export async function playCrowdSample(
	sample: SamplePlayback,
	buffer?: AudioBuffer,
	alreadyAligned = false,
): Promise<void> {
	if (activeId === sample.id) return
	stopCrowdSample()
	const op = operation
	const prepared = buffer ?? (await prepareCrowdSample(sample))
	if (op !== operation) return
	if (!alreadyAligned && !(await waitForPhrase(() => op !== operation))) return
	if (op !== operation) return
	const ac = getAudioContext()
	if (ac.state !== 'running')
		throw new Error('Enable host audio before playing a crowd sample.')
	const fullDuration = (8 * 240) / sample.bpm
	const remaining = sample.expiresAt
		? Math.min(fullDuration, (sample.expiresAt - Date.now()) / 1000)
		: fullDuration
	if (remaining <= 0) return
	activeId = sample.id
	const beat = 60 / sample.bpm
	const step =
		sample.use === 'percussion'
			? beat
			: sample.use === 'hook'
				? beat * 2
				: beat * 8
	const start = phraseAudioTime(sample.bpm)
	for (let offset = 0; offset < remaining; offset += step) {
		const source = ac.createBufferSource()
		const gain = ac.createGain()
		source.buffer = prepared
		if (sample.use === 'hook' && offset > 0) {
			source.playbackRate.value = [1, 1.25, 1, 0.75][
				Math.round(offset / step) % 4
			]
		}
		const length = Math.min(
			offset === 0
				? prepared.duration
				: sample.use === 'percussion'
					? 0.22
					: sample.use === 'hook'
						? 0.45
						: prepared.duration,
			prepared.duration / source.playbackRate.value,
			remaining - offset,
		)
		const at = start + offset
		gain.gain.setValueAtTime(0, at)
		gain.gain.linearRampToValueAtTime(
			sample.use === 'atmosphere' ? 0.12 : 0.28,
			at + Math.min(0.01, length / 3),
		)
		gain.gain.setValueAtTime(
			sample.use === 'atmosphere' ? 0.12 : 0.28,
			at + Math.max(0.01, length - 0.02),
		)
		gain.gain.linearRampToValueAtTime(0, at + length)
		source.connect(gain).connect(ac.destination)
		// Keep the first appearance recognizable; later hook hits use short slices.
		const slice =
			sample.use === 'hook' && offset > 0
				? ((Math.round(offset / step) % 3) * prepared.duration) / 4
				: 0
		source.start(
			at,
			slice,
			Math.min(length * source.playbackRate.value, prepared.duration - slice),
		)
		source.stop(at + length)
		source.onended = () => {
			source.disconnect()
			gain.disconnect()
		}
		nodes.push(source)
		if (offset === 0)
			offset = Math.max(0, Math.ceil(prepared.duration / step) * step - step)
	}
	expiry = setTimeout(stopCrowdSample, remaining * 1000 + 100)
}
