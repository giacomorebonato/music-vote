import { expect, test } from 'bun:test'
import {
	createRealtimeHub,
	createWsUpgradeHandler,
	type RoleResolver,
	type SocketData,
} from '@backend/realtime/hub'
import type { WsEvent } from '@shared/realtime/events'
import type { Server } from 'bun'

type TestSetup = {
	server: Server<SocketData>
	hub: ReturnType<typeof createRealtimeHub>
}

function startServer(resolveRole: RoleResolver): TestSetup {
	const hub = createRealtimeHub()
	const upgrade = createWsUpgradeHandler({ resolveRole })
	const server = Bun.serve<SocketData>({
		port: 0,
		routes: {
			'/ws': upgrade,
		},
		websocket: {
			open(ws) {
				const { roomId, role } = ws.data
				hub.joinRoom(ws, roomId, role, role === 'host')
			},
			close(ws) {
				hub.onClose(ws)
			},
			message() {
				// client -> server not used yet
			},
		},
	})
	return { server, hub }
}

function wsUrl(server: Server<SocketData>, roomId: string): string {
	return `ws://localhost:${server.port}/ws?room=${roomId}`
}

function openSocket(url: string): WebSocket {
	const ws = new WebSocket(url)
	return ws
}

function waitForOpen(ws: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		ws.onopen = () => resolve()
		ws.onerror = () => reject(new Error('websocket error'))
	})
}

function waitForClose(ws: WebSocket): Promise<void> {
	return new Promise((resolve) => {
		ws.onclose = () => resolve()
	})
}

function collectMessages(ws: WebSocket): WsEvent[] {
	const messages: WsEvent[] = []
	ws.onmessage = (event) => {
		messages.push(JSON.parse(event.data as string) as WsEvent)
	}
	return messages
}

test('two audience clients receive a published audience event', async () => {
	const resolveRole: RoleResolver = async () => ({ role: 'audience' })
	const { server, hub } = startServer(resolveRole)

	const ws1 = openSocket(wsUrl(server, 'room-a'))
	const ws2 = openSocket(wsUrl(server, 'room-a'))
	const messages1 = collectMessages(ws1)
	const messages2 = collectMessages(ws2)
	await Promise.all([waitForOpen(ws1), waitForOpen(ws2)])

	const event: WsEvent = {
		type: 'poll_opened',
		poll: {
			id: 'poll-1',
			question: 'Add melody?',
			options: ['yes', 'no'],
			closesAt: '2026-10-01T00:00:00.000Z',
		},
	}
	hub.publishAudience('room-a', event)

	await new Promise((resolve) => setTimeout(resolve, 50))
	expect(messages1).toHaveLength(1)
	expect(messages1[0]).toEqual(event)
	expect(messages2).toHaveLength(1)
	expect(messages2[0]).toEqual(event)

	ws1.close()
	ws2.close()
	await Promise.all([waitForClose(ws1), waitForClose(ws2)])
	server.stop(true)
})

test('host event is not delivered to audience clients', async () => {
	const resolveRole: RoleResolver = async () => ({ role: 'audience' })
	const { server, hub } = startServer(resolveRole)

	const ws = openSocket(wsUrl(server, 'room-a'))
	const messages = collectMessages(ws)
	await waitForOpen(ws)

	hub.publishAudience('room-a', {
		type: 'poll_opened',
		poll: {
			id: 'poll-1',
			question: 'Add melody?',
			options: ['yes', 'no'],
			closesAt: '2026-10-01T00:00:00.000Z',
		},
	})
	await new Promise((resolve) => setTimeout(resolve, 20))
	expect(messages).toHaveLength(1)

	hub.publishHost('room-a', {
		type: 'vote_count',
		pollId: 'poll-1',
		yes: 3,
		no: 1,
	})
	await new Promise((resolve) => setTimeout(resolve, 20))
	expect(messages).toHaveLength(1)

	ws.close()
	await waitForClose(ws)
	server.stop(true)
})

test('non-owner host attempt is rejected and connection closed', async () => {
	const resolveRole: RoleResolver = async () => ({
		error: new Response('not host', { status: 403 }),
	})
	const { server } = startServer(resolveRole)

	const ws = openSocket(wsUrl(server, 'room-a'))
	const closed = waitForClose(ws)
	await closed
	expect(ws.readyState).toBe(WebSocket.CLOSED)

	server.stop(true)
})
