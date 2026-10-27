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
	applyPattern: (code: string, phraseAligned?: boolean) => Promise<ApplyResult>
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
			): Promise<ApplyResult> => {
				const operation = ++operationRef.current
				if (
					phraseAligned &&
					!(await waitForPhrase(() => operation !== operationRef.current))
				)
					return { ok: false, error: 'Scheduled change cancelled' }
				const result = await applyPattern(candidate, autoplayRef.current)
				onResultRef.current(result)
				return result
			},
			[],
		)

		const stop = useCallback(() => {
			operationRef.current++
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
