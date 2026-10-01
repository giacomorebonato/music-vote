import {
	type ApplyResult,
	applyPattern,
	initStrudelOnce,
	stopStrudel,
} from '@frontend/audio/strudel-init'
import { forwardRef, useCallback, useEffect, useImperativeHandle } from 'react'

export type StrudelPlayerRef = {
	applyPattern: (code: string) => Promise<ApplyResult>
	stop: () => void
}

export type StrudelPlayerProps = {
	code: string | null
	onApplyResult: (result: ApplyResult) => void
	autoplay?: boolean
}

export const StrudelPlayer = forwardRef<StrudelPlayerRef, StrudelPlayerProps>(
	({ code, onApplyResult, autoplay = true }, ref) => {
		const run = useCallback(
			async (candidate: string) => {
				const result = await applyPattern(candidate, autoplay)
				onApplyResult(result)
				return result
			},
			[autoplay, onApplyResult],
		)

		useImperativeHandle(
			ref,
			() => ({
				applyPattern: run,
				stop: stopStrudel,
			}),
			[run],
		)

		useEffect(() => {
			if (code != null) {
				void run(code)
			}
		}, [code, run])

		useEffect(() => {
			void initStrudelOnce()
		}, [])

		useEffect(() => {
			return () => {
				stopStrudel()
			}
		}, [])

		return null
	},
)

StrudelPlayer.displayName = 'StrudelPlayer'
