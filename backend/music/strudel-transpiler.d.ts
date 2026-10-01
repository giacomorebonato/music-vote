declare module '@strudel/transpiler' {
	export function transpiler(
		code: string,
		options?: Record<string, unknown>,
	): { output: string }
}
