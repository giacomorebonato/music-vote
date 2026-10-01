import type { WsEvent } from '@shared/realtime/events'
import { useEffect, useRef, useState } from 'react'

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 10_000

/**
 * Minimal structural WebSocket surface. The browser global and the injected
 * test doubles both satisfy it, so the channel never opens a real socket in
 * unit tests.
 */
type WebSocketLike = {
	readyState: number
	onopen: ((event: Event) => void) | null
	onmessage: ((event: MessageEvent) => void) | null
	onclose: ((event: CloseEvent) => void) | null
	onerror: ((event: Event) => void) | null
	close(): void
}

type WebSocketFactory = (url: string) => WebSocketLike

type RoomScheduler = {
	schedule(callback: () => void, delayMs: number): unknown
	cancel(handle: unknown): void
}

export type RoomChannelOptions = {
	roomId: string
	onEvent: (event: WsEvent) => void
	/** Fired on every successful open after a drop, so the caller can resync. */
	onReconnect?: () => void
	onStatusChange?: (connected: boolean) => void
	url?: string
	wsFactory?: WebSocketFactory
	scheduler?: RoomScheduler
}

export type RoomChannel = { close: () => void }

const defaultScheduler: RoomScheduler = {
	schedule: (callback, delayMs) =>
		globalThis.setTimeout(callback, delayMs) as unknown,
	cancel: (handle) => globalThis.clearTimeout(handle as number),
}

function defaultUrl(roomId: string): string {
	const location = globalThis.location
	const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:'
	const host = location?.host ?? 'localhost'
	return `${protocol}//${host}/ws?room=${encodeURIComponent(roomId)}`
}

function parseEvent(raw: unknown): WsEvent | null {
	if (typeof raw !== 'string') return null
	try {
		const parsed = JSON.parse(raw) as { type?: unknown }
		return typeof parsed?.type === 'string' ? (parsed as WsEvent) : null
	} catch {
		return null
	}
}

/**
 * Host/audience WebSocket channel with auto-reconnect (1s, doubling, capped at
 * 10s). Framework-free so it is unit-testable with an injected socket factory
 * and scheduler; `useRoomChannel` binds it to a React component lifecycle.
 */
export function createRoomChannel(options: RoomChannelOptions): RoomChannel {
	const factory: WebSocketFactory =
		options.wsFactory ?? ((target) => new WebSocket(target))
	const scheduler = options.scheduler ?? defaultScheduler
	const url = options.url ?? defaultUrl(options.roomId)

	let socket: WebSocketLike | null = null
	let reconnectHandle: unknown = null
	let attempt = 0
	let closed = false
	let openedOnce = false

	function scheduleReconnect(): void {
		if (closed) return
		const delayMs = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
		attempt += 1
		reconnectHandle = scheduler.schedule(connect, delayMs)
	}

	function connect(): void {
		if (closed) return
		const next = factory(url)
		socket = next
		next.onopen = () => {
			attempt = 0
			options.onStatusChange?.(true)
			if (openedOnce) options.onReconnect?.()
			openedOnce = true
		}
		next.onmessage = (event) => {
			const parsed = parseEvent(event.data)
			if (parsed) options.onEvent(parsed)
		}
		next.onclose = () => {
			options.onStatusChange?.(false)
			scheduleReconnect()
		}
	}

	function close(): void {
		if (closed) return
		closed = true
		if (reconnectHandle !== null) {
			scheduler.cancel(reconnectHandle)
			reconnectHandle = null
		}
		socket?.close()
		options.onStatusChange?.(false)
	}

	connect()
	return { close }
}

export function useRoomChannel(
	roomId: string,
	options: {
		onEvent: (event: WsEvent) => void
		onReconnect?: () => void
	},
): { connected: boolean } {
	const [connected, setConnected] = useState(false)
	const onEventRef = useRef(options.onEvent)
	const onReconnectRef = useRef(options.onReconnect)

	onEventRef.current = options.onEvent
	onReconnectRef.current = options.onReconnect

	useEffect(() => {
		const channel = createRoomChannel({
			roomId,
			onEvent: (event) => onEventRef.current(event),
			onReconnect: () => onReconnectRef.current?.(),
			onStatusChange: setConnected,
		})
		return () => {
			channel.close()
		}
	}, [roomId])

	return { connected }
}
