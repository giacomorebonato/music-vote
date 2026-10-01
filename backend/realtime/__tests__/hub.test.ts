import { expect, test } from 'bun:test'
import {
	createProdRoleResolver,
	createRealtimeHub,
	createWsUpgradeHandler,
	type RoleResolver,
	type SessionLike,
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

test('host and audience sockets receive only their channel events', async () => {
	const resolveRole: RoleResolver = async (req) => {
		const url = new URL(req.url)
		return { role: url.searchParams.get('as') === 'host' ? 'host' : 'audience' }
	}
	const { server, hub } = startServer(resolveRole)

	const audienceWs = openSocket(`${wsUrl(server, 'room-a')}&as=audience`)
	const hostWs = openSocket(`${wsUrl(server, 'room-a')}&as=host`)
	const audienceMessages = collectMessages(audienceWs)
	const hostMessages = collectMessages(hostWs)
	await Promise.all([waitForOpen(audienceWs), waitForOpen(hostWs)])

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
	expect(audienceMessages).toHaveLength(1)
	expect(hostMessages).toHaveLength(0)

	hub.publishHost('room-a', {
		type: 'vote_count',
		pollId: 'poll-1',
		yes: 3,
		no: 1,
	})
	await new Promise((resolve) => setTimeout(resolve, 20))
	expect(audienceMessages).toHaveLength(1)
	expect(hostMessages).toHaveLength(1)
	expect(hostMessages[0]).toEqual({
		type: 'vote_count',
		pollId: 'poll-1',
		yes: 3,
		no: 1,
	})

	audienceWs.close()
	hostWs.close()
	await Promise.all([waitForClose(audienceWs), waitForClose(hostWs)])
	server.stop(true)
})

test('nonexistent room join is rejected and connection closed', async () => {
	const resolveRole: RoleResolver = async () => ({
		error: new Response('room not found', { status: 404 }),
	})
	const { server } = startServer(resolveRole)

	const ws = openSocket(wsUrl(server, 'room-a'))
	const closed = waitForClose(ws)
	await closed
	expect(ws.readyState).toBe(WebSocket.CLOSED)

	server.stop(true)
})

test('prod role resolver: owner session becomes host', async () => {
	const resolveRole = createProdRoleResolver({
		findRoom: async () => ({ hostId: 'user-1' }),
		getSession: async () => ({ user: { id: 'user-1' } }) as SessionLike,
	})
	const result = await resolveRole(
		new Request('http://localhost/ws?room=r1'),
		'r1',
	)
	expect(result).toEqual({ role: 'host' })
})

test('prod role resolver: non-owner session becomes audience', async () => {
	const resolveRole = createProdRoleResolver({
		findRoom: async () => ({ hostId: 'user-1' }),
		getSession: async () => ({ user: { id: 'user-2' } }) as SessionLike,
	})
	const result = await resolveRole(
		new Request('http://localhost/ws?room=r1'),
		'r1',
	)
	expect(result).toEqual({ role: 'audience' })
})

test('prod role resolver: anonymous session becomes audience', async () => {
	const resolveRole = createProdRoleResolver({
		findRoom: async () => ({ hostId: 'user-1' }),
		getSession: async () => null,
	})
	const result = await resolveRole(
		new Request('http://localhost/ws?room=r1'),
		'r1',
	)
	expect(result).toEqual({ role: 'audience' })
})

test('prod role resolver: missing room returns 404 error response', async () => {
	const resolveRole = createProdRoleResolver({
		findRoom: async () => null,
		getSession: async () => null,
	})
	const result = await resolveRole(
		new Request('http://localhost/ws?room=r1'),
		'r1',
	)
	expect('error' in result).toBe(true)
	if ('error' in result) {
		expect(result.error.status).toBe(404)
	}
})
