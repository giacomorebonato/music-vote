import { StateEffect, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { subscribePlayback } from '@frontend/audio/strudel-init'
import {
	initEditor,
	updateMiniLocations,
	highlightMiniLocations,
	highlightExtension,
} from '@strudel/codemirror'
import { Drawer, getPunchcardPainter } from '@strudel/draw'
import { getAudioContext } from '@strudel/web'
import { useEffect, useRef } from 'react'

/** Strudel's editor and renderer observe the player's existing scheduler. */
export function StrudelPattern({ code }: { code: string | null }) {
	const rootRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const root = rootRef.current
		const canvas = canvasRef.current
		const ctx = canvas?.getContext('2d')
		if (!root || !canvas || !ctx) return
		const view = initEditor({
			root,
			initialCode: code ?? '—',
			onChange: () => {},
		})
		view.dispatch({
			effects: StateEffect.appendConfig.of([
				highlightExtension,
				EditorState.readOnly.of(true),
				EditorView.editable.of(false),
				EditorView.contentAttributes.of({
					'aria-label': 'Current Strudel pattern',
					'aria-readonly': 'true',
				}),
				EditorView.lineWrapping,
				EditorView.theme({
					'&': { fontSize: '14px' },
					'.cm-scroller': { overflow: 'auto' },
				}),
			]),
		})
		const drawTime: [number, number] = [-2, 2]
		const paint = getPunchcardPainter({
			labels: true,
			active: '#facc15',
			inactive: '#60a5fa',
			playheadColor: '#f8fafc',
			fillActive: true,
		})
		const drawer = new Drawer((haps, time) => {
			// A suspended AudioContext has a scheduled pattern but no audible beat.
			if (getAudioContext()?.state !== 'running') return
			highlightMiniLocations(
				view,
				time,
				haps.filter((hap) => hap.isActive(time)),
			)
			paint(ctx, time, haps, drawTime)
		}, drawTime)
		const resize = new ResizeObserver(() => {
			canvas.width = Math.max(
				1,
				Math.round(canvas.clientWidth * window.devicePixelRatio),
			)
			canvas.height = Math.round(160 * window.devicePixelRatio)
		})
		resize.observe(canvas)
		const unsubscribe = subscribePlayback((state, scheduler) => {
			drawer.stop()
			// Only highlight source locations from the successfully evaluated code.
			const matches = state.activeCode === code
			updateMiniLocations(view, matches ? state.miniLocations : [])
			if (state.started && matches) drawer.start(scheduler)
			else {
				highlightMiniLocations(view, 0, [])
				ctx.clearRect(0, 0, canvas.width, canvas.height)
			}
		})
		return () => {
			unsubscribe()
			drawer.stop()
			resize.disconnect()
			view.destroy()
		}
	}, [code])

	return (
		<div className="overflow-hidden rounded-box bg-[#222222] text-[#eeeeee]">
			<div ref={rootRef} data-testid="current-code" />
			<canvas
				ref={canvasRef}
				className="block h-40 w-full"
				role="img"
				aria-label="Live pattern piano roll"
				data-testid="pattern-visual"
			/>
		</div>
	)
}
