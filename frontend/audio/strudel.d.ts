declare module '@strudel/web' {
	export type Hap = { isActive: (time: number) => boolean }
	export type Scheduler = { now: () => number; pattern: unknown }
	export type ReplState = {
		activeCode: string
		miniLocations: [number, number][]
		started: boolean
	}
	export function initStrudel(options?: {
		onEvalError?: (err: Error) => void
		prebake?: () => Promise<void>
		miniAllStrings?: boolean
		[option: string]: unknown
	}): Promise<{ scheduler: Scheduler; state: ReplState }>
	export function hush(): void
	export function evaluate(code: string, autoplay?: boolean): Promise<unknown>
	export function samples(sampleMap: string, baseUrl?: string): Promise<unknown>
	export function loadBuffer(
		url: string,
		ac: AudioContext,
		label?: string,
	): Promise<AudioBuffer>
	export function getAudioContext(): AudioContext
	export function getSound(
		name: string,
	): { onTrigger: unknown; data: { samples: unknown; _base?: string } } | null
	export function getSampleInfo(
		hapValue: Record<string, unknown>,
		bank: unknown,
	): { url: string; label: string }
}

declare module '@strudel/codemirror' {
	import type { Extension } from '@codemirror/state'
	import type { EditorView } from '@codemirror/view'
	import type { Hap } from '@strudel/web'
	export function initEditor(options: {
		root: HTMLElement
		initialCode: string
		onChange: () => void
	}): EditorView
	export const highlightExtension: Extension
	export function updateMiniLocations(
		view: EditorView,
		locations: [number, number][],
	): void
	export function highlightMiniLocations(
		view: EditorView,
		time: number,
		haps: Hap[],
	): void
}

declare module '@strudel/draw' {
	import type { Hap, Scheduler } from '@strudel/web'
	export class Drawer {
		constructor(
			onDraw: (haps: Hap[], time: number) => void,
			drawTime: [number, number],
		)
		start(scheduler: Scheduler): void
		stop(): void
		invalidate(scheduler: Scheduler): void
	}
	export function getPunchcardPainter(
		options: Record<string, unknown>,
	): (
		ctx: CanvasRenderingContext2D,
		time: number,
		haps: Hap[],
		drawTime: [number, number],
	) => void
}
