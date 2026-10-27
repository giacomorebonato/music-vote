import { expect, mock, test } from 'bun:test'

const playbackState = {
	activeCode: '// LOADING',
	miniLocations: [],
	started: false,
}
const scheduler = { now: () => 0, pattern: null }
const initStrudel = mock((_options: unknown) =>
	Promise.resolve({ scheduler, state: playbackState }),
)
const hush = mock(() => undefined)
const evaluate = mock(() => Promise.resolve(undefined as unknown))
const samples = mock(() => Promise.resolve())
const loadBuffer = mock(() => Promise.resolve())
const getAudioContext = mock((): AudioContext | null => null)
const getSound = mock(() => null)
const getSampleInfo = mock(() => ({
	url: 'https://example.com/sample.wav',
	label: 'bd:0',
}))

mock.module('@strudel/web', () => ({
	initStrudel,
	hush,
	evaluate,
	samples,
	loadBuffer,
	getAudioContext,
	getSound,
	getSampleInfo,
}))

const {
	applyPattern,
	stopStrudel,
	initStrudelOnce,
	resumeAudio,
	subscribePlayback,
} = await import('@frontend/audio/strudel-init')

function audioContextFake(
	state: string,
	resumeFlipsState = false,
): AudioContext {
	const ctx = {
		state,
		resume: async () => {
			if (resumeFlipsState) ctx.state = 'running'
		},
	}
	return ctx as unknown as AudioContext
}

// --- resumeAudio ---

test('resumeAudio: false when there is no AudioContext', async () => {
	getAudioContext.mockImplementationOnce(() => null as unknown as AudioContext)
	expect(await resumeAudio()).toBe(false)
})

test('resumeAudio: true for an already-running context', async () => {
	getAudioContext.mockImplementationOnce(
		() => audioContextFake('running') as unknown as AudioContext,
	)
	expect(await resumeAudio()).toBe(true)
})

test('resumeAudio: resumes a suspended context and reports running', async () => {
	getAudioContext.mockImplementationOnce(
		() => audioContextFake('suspended', true) as unknown as AudioContext,
	)
	expect(await resumeAudio()).toBe(true)
})

test('resumeAudio: reports false when resume leaves the context suspended', async () => {
	getAudioContext.mockImplementationOnce(
		() => audioContextFake('suspended') as unknown as AudioContext,
	)
	expect(await resumeAudio()).toBe(false)
})

test('applyPattern: reports audioRunning true when the context resumes', async () => {
	evaluate.mockImplementationOnce(() =>
		Promise.resolve({ __pattern: true } as unknown),
	)
	getAudioContext.mockImplementationOnce(
		() => audioContextFake('suspended', true) as unknown as AudioContext,
	)
	const result = await applyPattern('s("bd sd")')
	expect(result.ok).toBe(true)
	if (result.ok) expect(result.audioRunning).toBe(true)
})

test('applyPattern: reports audioRunning false when audio stays blocked', async () => {
	evaluate.mockImplementationOnce(() =>
		Promise.resolve({ __pattern: true } as unknown),
	)
	getAudioContext.mockImplementationOnce(
		() => audioContextFake('suspended') as unknown as AudioContext,
	)
	const result = await applyPattern('s("bd sd")')
	expect(result.ok).toBe(true)
	if (result.ok) expect(result.audioRunning).toBe(false)
})

test('applyPattern: skips the audio resume check when autoplay is off', async () => {
	// Mock calls accumulate across this file's tests; clear first.
	getAudioContext.mockClear()
	evaluate.mockImplementationOnce(() =>
		Promise.resolve({ __pattern: true } as unknown),
	)
	const result = await applyPattern('s("bd sd")', false)
	expect(result.ok).toBe(true)
	if (result.ok) expect(result.audioRunning).toBe(true)
	expect(getAudioContext).not.toHaveBeenCalled()
})

test('applyPattern reports success for valid code', async () => {
	evaluate.mockImplementationOnce(() =>
		Promise.resolve({ __pattern: true } as unknown),
	)
	const result = await applyPattern('s("bd sd")')
	expect(result.ok).toBe(true)
	expect(evaluate).toHaveBeenCalledWith('s("bd sd")', true)
	initStrudelOnce()
	expect(initStrudel).toHaveBeenCalledTimes(1)
})

test('applyPattern reports error when evaluate resolves undefined', async () => {
	evaluate.mockImplementationOnce(() => Promise.resolve(undefined as unknown))
	const result = await applyPattern('this is ( broken')
	expect(result.ok).toBe(false)
	if (!result.ok) {
		expect(result.error).toBe('evaluation failed')
	}
})

test('applyPattern reports error for explicitly rejected evaluate', async () => {
	evaluate.mockImplementationOnce(() =>
		Promise.reject(new Error('parse error')),
	)
	const result = await applyPattern('this is ( broken')
	expect(result.ok).toBe(false)
	if (!result.ok) {
		expect(result.error).toBe('parse error')
	}
})

test('a second applyPattern call while playing does not throw', async () => {
	evaluate.mockImplementationOnce(() =>
		Promise.resolve({ __pattern: true } as unknown),
	)
	await applyPattern('s("bd sd")')
	evaluate.mockImplementationOnce(() => Promise.resolve(undefined as unknown))
	const result = await applyPattern('s("cp")')
	expect(result.ok).toBe(false)
})

test('stop calls hush', () => {
	stopStrudel()
	expect(hush).toHaveBeenCalled()
})

test('playback observers receive the existing scheduler and can unsubscribe', async () => {
	await initStrudelOnce()
	const listener = mock(() => undefined)
	const unsubscribe = subscribePlayback(listener)
	expect(listener).toHaveBeenCalledWith(playbackState, scheduler)
	unsubscribe()
	const options = initStrudel.mock.calls[0]?.[0] as unknown as {
		onUpdateState: (state: typeof playbackState) => void
	}
	options.onUpdateState({ ...playbackState, started: true })
	expect(listener).toHaveBeenCalledTimes(1)
})
