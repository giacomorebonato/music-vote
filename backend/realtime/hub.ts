import type { WsEvent } from '@shared/realtime/events'
import type { Server, ServerWebSocket } from 'bun'

/** @public */
export type ChannelRole = 'audience' | 'host'

/** @public */
export type SocketData = {
	roomId: string
	role: ChannelRole
}

/** @public */
export type RealtimeHub = {
	/** Register a socket in a room/channel. */
	joinRoom(
		ws: ServerWebSocket<SocketData>,
		roomId: string,
		role: ChannelRole,
		isHost: boolean,
	): void
	/** Remove a socket from all channels (call from the server close handler). */
	onClose(ws: ServerWebSocket<SocketData>): void
	/** Broadcast an event to every audience socket in the room. */
	publishAudience(roomId: string, event: WsEvent): void
	/** Send an event to the host socket(s) in the room. */
	publishHost(roomId: string, event: WsEvent): void
}

type RoomChannels = {
	audience: Set<ServerWebSocket<SocketData>>
	host: Set<ServerWebSocket<SocketData>>
}

type SocketMeta = {
	roomId: string
	role: ChannelRole
}

/** @public */
export function createRealtimeHub(): RealtimeHub {
	const rooms = new Map<string, RoomChannels>()
	const sockets = new WeakMap<ServerWebSocket<SocketData>, SocketMeta>()

	function roomChannels(roomId: string): RoomChannels {
		let channels = rooms.get(roomId)
		if (!channels) {
			channels = { audience: new Set(), host: new Set() }
			rooms.set(roomId, channels)
		}
		return channels
	}

	function remove(ws: ServerWebSocket<SocketData>): void {
		const meta = sockets.get(ws)
		if (!meta) return
		const channels = rooms.get(meta.roomId)
		if (channels) {
			channels[meta.role].delete(ws)
			if (channels.audience.size === 0 && channels.host.size === 0) {
				rooms.delete(meta.roomId)
			}
		}
		sockets.delete(ws)
	}

	function publish(roomId: string, role: ChannelRole, event: WsEvent): void {
		const channels = rooms.get(roomId)
		if (!channels) return
		const data = JSON.stringify(event)
		for (const ws of channels[role]) {
			if (ws.readyState !== 1) {
				remove(ws)
				continue
			}
			try {
				ws.send(data)
			} catch {
				remove(ws)
			}
		}
	}

	const hub: RealtimeHub = {
		joinRoom(ws, roomId, role, _isHost): void {
			const channels = roomChannels(roomId)
			channels[role].add(ws)
			sockets.set(ws, { roomId, role })
		},

		onClose(ws): void {
			remove(ws)
		},

		publishAudience(roomId, event): void {
			publish(roomId, 'audience', event)
		},

		publishHost(roomId, event): void {
			publish(roomId, 'host', event)
		},
	}
	return hub
}

/** @public */
export type RoleResult = { role: ChannelRole } | { error: Response }

/** @public */
export type RoleResolver = (req: Request, roomId: string) => Promise<RoleResult>

/** @public */
export function createWsUpgradeHandler({
	resolveRole,
}: {
	resolveRole: RoleResolver
}): (
	req: Request,
	server: Server<SocketData>,
) => Promise<Response | undefined> {
	return async (req, server) => {
		const url = new URL(req.url)
		const roomId = url.searchParams.get('room')
		if (!roomId) {
			return new Response(JSON.stringify({ error: 'missing room' }), {
				status: 400,
				headers: { 'content-type': 'application/json' },
			})
		}

		const result = await resolveRole(req, roomId)
		if ('error' in result) return result.error

		const success = server.upgrade(req, {
			data: { roomId, role: result.role },
		})
		if (!success) {
			return new Response(JSON.stringify({ error: 'upgrade failed' }), {
				status: 500,
				headers: { 'content-type': 'application/json' },
			})
		}
		return undefined
	}
}

/** @public */
export type SessionLike = { user?: { id: string } } | null | undefined

/** @public */
export type RoomLike = { hostId: string } | null

/** @public */
export function createProdRoleResolver({
	getSession,
	findRoom,
}: {
	getSession: (req: Request) => Promise<SessionLike>
	findRoom: (roomId: string) => Promise<RoomLike>
}): RoleResolver {
	return async (req, roomId) => {
		const room = await findRoom(roomId)
		if (!room) {
			return {
				error: new Response(JSON.stringify({ error: 'room not found' }), {
					status: 404,
					headers: { 'content-type': 'application/json' },
				}),
			}
		}
		const session = await getSession(req)
		if (session?.user?.id === room.hostId) {
			return { role: 'host' as ChannelRole }
		}
		return { role: 'audience' as ChannelRole }
	}
}

/** @public Convenience singleton used by the production server. */
export const hub = createRealtimeHub()
