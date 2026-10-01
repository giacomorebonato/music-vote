declare module '@strudel/web' {
	export function initStrudel(options?: {
		onEvalError?: (err: Error) => void
		prebake?: () => Promise<void>
		miniAllStrings?: boolean
		[option: string]: unknown
	}): Promise<unknown>
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
