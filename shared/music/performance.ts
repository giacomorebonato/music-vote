export const MARKER = '// music-vote performance\n'

export type PerformanceLayer = 'build' | 'drop' | 'strip'
export type PerformanceAction = PerformanceLayer | 'clear'

const transforms: Record<PerformanceLayer, string> = {
	build: 'all(x => stack(x.hpf(700).mul(gain(0.65)), s("sd*8").gain(0.12)))',
	drop: 'all(x => stack(x.mul(gain(0.9)), s("bd*4").gain(0.22), s("cp ~ ~ ~").gain(0.12)))',
	strip: 'all(x => x.lpf(550).mul(gain(0.65)))',
}

/**
 * Replace an earlier performance layer rather than stacking gain or filters;
 * `clear` strips the layer and returns the base groove unchanged.
 */
export function performancePattern(
	code: string,
	action: PerformanceAction,
): string {
	const base = code.startsWith(MARKER)
		? code.slice(code.indexOf('\n', MARKER.length) + 1)
		: code
	if (action === 'clear') return base
	return `${MARKER}${transforms[action]}\n${base}`
}

/** The layer currently playing in `code`, or null when the groove is plain. */
export function activePerformanceAction(code: string): PerformanceLayer | null {
	if (!code.startsWith(MARKER)) return null
	const line = code.slice(MARKER.length).split('\n')[0]
	return (
		(Object.keys(transforms) as PerformanceLayer[]).find(
			(action) => transforms[action] === line,
		) ?? null
	)
}
