import { afterEach, beforeEach, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { resolve as resolvePath } from 'node:path'

import { lightpandaBinary } from '@backend/ssr/request-from-browser'

const DEFAULT_BINARY = resolvePath(
	`${homedir()}/.cache/lightpanda-node/lightpanda`,
)

const original = process.env.LIGHTPANDA_EXECUTABLE_PATH

beforeEach(() => {
	delete process.env.LIGHTPANDA_EXECUTABLE_PATH
})

afterEach(() => {
	if (original === undefined) delete process.env.LIGHTPANDA_EXECUTABLE_PATH
	else process.env.LIGHTPANDA_EXECUTABLE_PATH = original
})

test('defaults to the postinstall-cached browser binary when unset', () => {
	expect(lightpandaBinary()).toBe(DEFAULT_BINARY)
})

test('an empty LIGHTPANDA_EXECUTABLE_PATH falls back to the default', () => {
	process.env.LIGHTPANDA_EXECUTABLE_PATH = ''
	expect(lightpandaBinary()).toBe(DEFAULT_BINARY)
})

test('a whitespace-only LIGHTPANDA_EXECUTABLE_PATH falls back to the default', () => {
	process.env.LIGHTPANDA_EXECUTABLE_PATH = '   '
	expect(lightpandaBinary()).toBe(DEFAULT_BINARY)
})

test('an explicit LIGHTPANDA_EXECUTABLE_PATH wins', () => {
	process.env.LIGHTPANDA_EXECUTABLE_PATH = '/opt/lightpanda/lightpanda'
	expect(lightpandaBinary()).toBe('/opt/lightpanda/lightpanda')
})
