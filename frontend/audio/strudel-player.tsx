import { stopCrowdSample } from '@frontend/audio/crowd-sampler'
import {
	type ApplyResult,
	applyPattern,
	initStrudelOnce,
	stopStrudel,
	waitForPhrase,
} from '@frontend/audio/strudel-init'
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
} from 'react'

export type StrudelPlayerRef = {
	applyPattern: (
		code: string,
		phraseAligned?: boolean,
		beforeApply?: (finalCheck?: boolean) => Promise<void>,
		afterApply?: () => Promise<void>,
	) => Promise<ApplyResult>
	stop: () => void
}

export type StrudelPlayerProps = {
	code: string | null
	onApplyResult: (result: ApplyResult) => void
	autoplay?: boolean
}

export const StrudelPlayer = forwardRef<StrudelPlayerRef, StrudelPlayerProps>(
	({ code, onApplyResult, autoplay = true }, ref) => {
		const autoplayRef = useRef(autoplay)
		const onResultRef = useRef(onApplyResult)

		autoplayRef.current = autoplay
		onResultRef.current = onApplyResult

		const operationRef = useRef(0)
		const run = useCallback(
			async (
				candidate: string,
				phraseAligned = false,
				beforeApply?: (finalCheck?: boolean) => Promise<void>,
				afterApply?: () => Promise<void>,
			): Promise<ApplyResult> => {
				const operation = ++operationRef.current
				try {
					await beforeApply?.(false)
				} catch (e) {
					return {
						ok: false,
						error: e instanceof Error ? e.message : 'Preparation failed',
					}
				}
				if (
					phraseAligned &&
					!(await waitForPhrase(() => operation !== operationRef.current))
				)
					return { ok: false, error: 'Scheduled change cancelled' }
				if (operation !== operationRef.current)
					return { ok: false, error: 'Scheduled change cancelled' }
				try {
					await beforeApply?.(true)
				} catch (e) {
					return {
						ok: false,
						error:
							e instanceof Error ? e.message : 'Contribution no longer current',
					}
				}
				if (operation !== operationRef.current)
					return { ok: false, error: 'Scheduled change cancelled' }
				const result = await applyPattern(candidate, autoplayRef.current)
				if (result.ok && result.audioRunning) {
					try {
						await afterApply?.()
					} catch (e) {
						return {
							ok: false,
							error: e instanceof Error ? e.message : 'Sample playback failed',
						}
					}
				}
				onResultRef.current(result)
				return result
			},
			[],
		)

		const stop = useCallback(() => {
			operationRef.current++
			stopCrowdSample()
			stopStrudel()
		}, [])

		useImperativeHandle(
			ref,
			() => ({
				applyPattern: run,
				stop,
			}),
			[run, stop],
		)

		useEffect(() => {
			if (code != null) {
				void run(code)
			}
		}, [code, run])

		useEffect(() => {
			void initStrudelOnce()
		}, [])

		useEffect(() => stop, [stop])

		return null
	},
)

StrudelPlayer.displayName = 'StrudelPlayer'
