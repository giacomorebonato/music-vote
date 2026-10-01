import { expect, mock, test } from 'bun:test'

const initStrudel = mock(() => Promise.resolve())
const hush = mock(() => undefined)
const evaluate = mock(() => Promise.resolve())
const samples = mock(() => Promise.resolve())

mock.module('@strudel/web', () => ({
	initStrudel,
	hush,
	evaluate,
	samples,
}))

const { applyPattern, stopStrudel, initStrudelOnce } = await import(
	'@frontend/audio/strudel-init'
)

test('applyPattern reports success for valid code', async () => {
	evaluate.mockImplementationOnce(() => Promise.resolve())
	const result = await applyPattern('s("bd sd")')
	expect(result.ok).toBe(true)
	expect(evaluate).toHaveBeenCalledWith('s("bd sd")', true)
	initStrudelOnce()
	expect(initStrudel).toHaveBeenCalledTimes(1)
})

test('applyPattern reports error for broken code without throwing', async () => {
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
	evaluate.mockImplementationOnce(() => Promise.resolve())
	await applyPattern('s("bd sd")')
	evaluate.mockImplementationOnce(() => Promise.reject(new Error('boom')))
	const result = await applyPattern('s("cp")')
	expect(result.ok).toBe(false)
})

test('stop calls hush', () => {
	stopStrudel()
	expect(hush).toHaveBeenCalled()
})

test('StrudelPlayer is a forwardRef component', async () => {
	const { StrudelPlayer } = await import('@frontend/audio/strudel-player')
	expect(StrudelPlayer).toBeDefined()
	expect(StrudelPlayer.displayName).toBe('StrudelPlayer')
})
