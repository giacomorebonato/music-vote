import { expect, mock, test } from 'bun:test'

const initStrudel = mock(() => Promise.resolve())
const hush = mock(() => undefined)
const evaluate = mock(() => Promise.resolve(undefined as unknown))
const samples = mock(() => Promise.resolve())
const loadBuffer = mock(() => Promise.resolve())
const getAudioContext = mock(() => null)
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

const { applyPattern, stopStrudel, initStrudelOnce } = await import(
	'@frontend/audio/strudel-init'
)

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
