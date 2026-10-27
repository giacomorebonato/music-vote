import type { performanceActionSchema } from '@shared/schemas/room'
import type { z } from 'zod'

type PerformanceAction = z.infer<typeof performanceActionSchema>['action']
const MARKER = '// music-vote performance\n'
const transforms: Record<PerformanceAction, string> = {
	build: 'all(x => stack(x.hpf(700).mul(gain(0.65)), s("sd*8").gain(0.12)))',
	drop: 'all(x => stack(x.mul(gain(0.9)), s("bd*4").gain(0.22), s("cp ~ ~ ~").gain(0.12)))',
	strip: 'all(x => x.lpf(550).mul(gain(0.65)))',
}

/** Replace an earlier performance layer rather than stacking gain or filters. */
export function performancePattern(
	code: string,
	action: PerformanceAction,
): string {
	const base = code.startsWith(MARKER)
		? code.slice(code.indexOf('\n', MARKER.length) + 1)
		: code
	return `${MARKER}${transforms[action]}\n${base}`
}
