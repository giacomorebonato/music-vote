import { expect, test } from 'bun:test'
import { createRoomChannel } from '@frontend/lib/room-ws'
import type { WsEvent } from '@shared/realtime/events'

class FakeSocket {
	static instances: FakeSocket[] = []

	readonly url: string
	readyState = 1
	onopen: (() => void) | null = null
	onmessage: ((event: MessageEvent) => void) | null = null
	onclose: (() => void) | null = null
	onerror: (() => void) | null = null

	constructor(url: string) {
		this.url = url
		FakeSocket.instances.push(this)
	}

	close(): void {
		this.readyState = 3
	}

	emitOpen(): void {
		this.onopen?.()
	}

	emitMessage(data: string): void {
		this.onmessage?.({ data } as MessageEvent)
	}

	emitDrop(): void {
		this.readyState = 3
		this.onclose?.()
	}
}

type Scheduled = { callback: () => void; delayMs: number; cancelled: boolean }

function makeHarness() {
	FakeSocket.instances = []
	const scheduled: Scheduled[] = []
	const events: WsEvent[] = []
	let reconnects = 0
	let connected: boolean | null = null

	const channel = createRoomChannel({
		roomId: 'room-1',
		url: 'ws://test.invalid/ws?room=room-1',
		wsFactory: (url) => new FakeSocket(url),
		scheduler: {
			schedule: (callback, delayMs) => {
				const entry: Scheduled = { callback, delayMs, cancelled: false }
				scheduled.push(entry)
				return entry
			},
			cancel: (handle) => {
				;(handle as Scheduled).cancelled = true
			},
		},
		onEvent: (event) => events.push(event),
		onReconnect: () => {
			reconnects += 1
		},
		onStatusChange: (isConnected) => {
			connected = isConnected
		},
	})

	return {
		channel,
		scheduled,
		events,
		get reconnects() {
			return reconnects
		},
		get connected() {
			return connected
		},
	}
}

test('dispatches parsed events to onEvent', () => {
	const harness = makeHarness()
	const socket = FakeSocket.instances[0]
	expect(socket?.url).toBe('ws://test.invalid/ws?room=room-1')

	socket?.emitOpen()
	expect(harness.connected).toBe(true)

	socket?.emitMessage(JSON.stringify({ type: 'warning', message: 'llm down' }))
	expect(harness.events).toEqual([{ type: 'warning', message: 'llm down' }])

	socket?.emitMessage('not json')
	expect(harness.events).toHaveLength(1)

	harness.channel.close()
})

test('reconnects after close and signals resync on reconnect', () => {
	const harness = makeHarness()
	const first = FakeSocket.instances[0]
	first?.emitOpen()
	expect(harness.reconnects).toBe(0)

	first?.emitDrop()
	expect(harness.connected).toBe(false)
	expect(harness.scheduled[0]?.delayMs).toBe(1000)

	harness.scheduled[0]?.callback()
	const second = FakeSocket.instances[1]
	expect(second).toBeDefined()
	second?.emitOpen()
	expect(harness.reconnects).toBe(1)
	expect(harness.connected).toBe(true)

	harness.channel.close()
})

test('backoff doubles after each failed attempt (no successful open)', () => {
	const harness = makeHarness()

	FakeSocket.instances[0]?.emitDrop()
	harness.scheduled[0]?.callback()
	FakeSocket.instances[1]?.emitDrop()
	harness.scheduled[1]?.callback()
	FakeSocket.instances[2]?.emitDrop()

	expect(harness.scheduled.map((entry) => entry.delayMs)).toEqual([
		1000, 2000, 4000,
	])

	harness.channel.close()
})

test('backoff is capped at 10s', () => {
	const harness = makeHarness()
	for (let i = 0; i < 6; i++) {
		FakeSocket.instances.at(-1)?.emitDrop()
		harness.scheduled.at(-1)?.callback()
	}
	const delays = harness.scheduled.map((entry) => entry.delayMs)
	expect(delays).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000])
	harness.channel.close()
})

test('close cancels the pending reconnect and closes the socket', () => {
	const harness = makeHarness()
	const socket = FakeSocket.instances[0]
	socket?.emitOpen()
	socket?.emitDrop()
	expect(harness.scheduled).toHaveLength(1)

	harness.channel.close()
	expect(harness.scheduled[0]?.cancelled).toBe(true)
	expect(socket?.readyState).toBe(3)

	harness.scheduled[0]?.callback()
	expect(FakeSocket.instances).toHaveLength(1)
})
