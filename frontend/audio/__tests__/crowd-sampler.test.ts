import { afterEach, expect, mock, test } from 'bun:test'

const starts: number[] = []
const stops: number[] = []
const context = {
	state: 'running',
	currentTime: 10,
	destination: {},
	createGain: () => ({
		gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
		connect() {},
		disconnect() {},
	}),
	createBufferSource: () => ({
		buffer: null,
		playbackRate: { value: 1 },
		connect(node: unknown) {
			return node
		},
		start(at: number) {
			starts.push(at)
		},
		stop(at?: number) {
			stops.push(at ?? 0)
		},
		disconnect() {},
		onended: null,
	}),
}
mock.module('@strudel/web', () => ({
	getAudioContext: () => context,
	loadBuffer: async () => ({ duration: 0.5 }),
}))
mock.module('@frontend/audio/strudel-init', () => ({
	initStrudelOnce: async () => {},
	waitForPhrase: async () => true,
	phraseAudioTime: () => 10.12,
}))
const { playCrowdSample, stopCrowdSample } =
	await import('@frontend/audio/crowd-sampler')
afterEach(() => {
	stopCrowdSample()
	starts.length = 0
	stops.length = 0
})
const sample = {
	id: 'sample',
	url: '/api/recordings/sample',
	use: 'percussion' as const,
	bpm: 120,
}

test('sample hits follow the host clock, every source stops, and repeated reconciliation cannot restart a clip', async () => {
	await playCrowdSample(sample, { duration: 0.5 } as AudioBuffer)
	expect(starts[0]).toBe(10.12)
	expect(starts).toHaveLength(32)
	expect(stops).toHaveLength(32)
	expect(Math.max(...stops)).toBeLessThanOrEqual(26.12)
	await playCrowdSample({ ...sample, url: '/refreshed-ticket' })
	expect(starts).toHaveLength(32)
})
test('reload recovery respects remaining lifetime and expired samples do not play', async () => {
	await playCrowdSample({ ...sample, expiresAt: Date.now() + 1100 }, {
		duration: 0.5,
	} as AudioBuffer)
	expect(starts.length).toBeLessThanOrEqual(3)
	stopCrowdSample()
	starts.length = 0
	await playCrowdSample({ ...sample, expiresAt: Date.now() - 1 }, {
		duration: 0.5,
	} as AudioBuffer)
	expect(starts).toHaveLength(0)
})
