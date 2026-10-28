import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '@backend/db/client'
import {
	audienceToken,
	liveRoom,
	notifyContributions,
} from '@backend/contributions'
import {
	sampleUseSchema,
	type SamplePlayback,
} from '@shared/schemas/contributions'

const root = resolve(process.env.RECORDINGS_DIR || '.recordings')
const secret = process.env.BETTER_AUTH_SECRET || crypto.randomUUID()
const MAX_BYTES = 2 * 1024 * 1024
const terminal = ['expired', 'withdrawn', 'failed', 'rejected']
let processing = false
function filePath(id: string, extension = 'wav'): string {
	if (!/^[a-z0-9]+$/i.test(id)) throw new Error('Invalid recording ID')
	return resolve(root, `${id}.${extension}`)
}
function signature(id: string, roomId: string, expires: string): string {
	return createHmac('sha256', secret)
		.update(`${id}:${roomId}:${expires}`)
		.digest('base64url')
}
export function samplePlayback(
	recording: {
		id: string
		roomId: string
		use: string
		expiresAt?: Date | null
	},
	bpm: number,
): SamplePlayback {
	const expires = String(Math.ceil(Date.now() / 60_000) * 60_000 + 120_000)
	return {
		id: recording.id,
		use: sampleUseSchema.parse(recording.use),
		bpm,
		url: `/api/recordings/${recording.id}?roomId=${recording.roomId}&expires=${expires}&signature=${signature(recording.id, recording.roomId, expires)}`,
		...(recording.expiresAt
			? { expiresAt: recording.expiresAt.getTime() }
			: {}),
	}
}

/** Decode a bounded input into small mono PCM. No shell, remote protocols or arbitrary paths. */
export async function prepareRecording(
	input: string,
	output: string,
	trimStart = 0,
	trimEnd = 3,
): Promise<number> {
	const child = Bun.spawn(
		[
			process.env.FFMPEG_PATH || 'ffmpeg',
			'-nostdin',
			'-hide_banner',
			'-loglevel',
			'error',
			'-threads',
			'1',
			'-max_alloc',
			'16777216',
			'-format_whitelist',
			'mov,matroska,webm,ogg,wav,mp3,aac,flac',
			'-protocol_whitelist',
			'file,pipe',
			'-t',
			'3',
			'-i',
			input,
			'-ss',
			String(trimStart),
			'-t',
			String(trimEnd - trimStart),
			'-vn',
			'-ac',
			'1',
			'-ar',
			'24000',
			'-af',
			'silenceremove=start_periods=1:start_threshold=-45dB,highpass=f=60,loudnorm=I=-20:TP=-3:LRA=7,afade=t=in:d=0.01,areverse,afade=t=in:d=0.01,areverse',
			'-c:a',
			'pcm_s16le',
			'-f',
			'wav',
			'-y',
			output,
		],
		{ stdout: 'ignore', stderr: 'ignore' },
	)
	const timer = setTimeout(() => child.kill(), 15_000)
	try {
		if ((await child.exited) !== 0)
			throw new Error('This clip could not be decoded. Try recording again.')
	} finally {
		clearTimeout(timer)
	}
	const data = new DataView(await Bun.file(output).arrayBuffer())
	// FFmpeg writes a RIFF/WAVE header with optional metadata chunks.
	let bytes = 0
	let rate = 0
	for (let offset = 12; offset + 8 <= data.byteLength;) {
		const tag = String.fromCharCode(...new Uint8Array(data.buffer, offset, 4))
		const size = data.getUint32(offset + 4, true)
		if (tag === 'fmt ' && size >= 16)
			rate = data.getUint32(offset + 8 + 8, true)
		if (tag === 'data') bytes = Math.min(size, data.byteLength - offset - 8)
		offset += 8 + size + (size % 2)
	}
	const duration = rate ? bytes / rate : 0
	if (duration < 0.08 || duration > 3.05)
		throw new Error('Record a clear sound lasting at most three seconds.')
	return duration
}

async function processRecordingQueue(): Promise<void> {
	if (processing) return
	processing = true
	try {
		for (;;) {
			const recording = await prisma.recording.findFirst({
				where: { status: 'queued' },
				orderBy: { createdAt: 'asc' },
			})
			if (!recording) break
			const room = await prisma.room.findUnique({
				where: { id: recording.roomId },
			})
			if (room?.status !== 'live' || !room.recordingsEnabled) {
				await prisma.recording.update({
					where: { id: recording.id },
					data: { status: 'expired' },
				})
				continue
			}
			const claimed = await prisma.recording.updateMany({
				where: { id: recording.id, status: 'queued' },
				data: { status: 'processing' },
			})
			if (!claimed.count) continue
			try {
				const duration = await prepareRecording(
					filePath(recording.id, 'input'),
					filePath(recording.id),
					recording.trimStart,
					recording.trimEnd,
				)
				const fresh = await prisma.room.findUnique({ where: { id: room.id } })
				await prisma.recording.updateMany({
					where: { id: recording.id, status: 'processing' },
					data: {
						duration,
						status:
							fresh?.status === 'live' && fresh.recordingsEnabled
								? fresh.sampleApproval
									? 'review'
									: 'ready'
								: 'expired',
					},
				})
			} catch (error) {
				await prisma.recording.updateMany({
					where: { id: recording.id, status: 'processing' },
					data: {
						status: 'failed',
						reason:
							error instanceof Error
								? error.message
								: 'Could not prepare this recording.',
					},
				})
			} finally {
				await rm(filePath(recording.id, 'input'), { force: true })
				notifyContributions(recording.roomId)
			}
		}
	} finally {
		processing = false
	}
}

async function boundedBody(req: Request): Promise<Uint8Array> {
	if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES)
		throw new Error('Clip exceeds the 2 MiB limit.')
	const reader = req.body?.getReader()
	if (!reader) throw new Error('No recording supplied.')
	const chunks: Uint8Array[] = []
	let size = 0
	for (;;) {
		const next = await reader.read()
		if (next.done) break
		size += next.value.byteLength
		if (size > MAX_BYTES) {
			await reader.cancel()
			throw new Error('Clip exceeds the 2 MiB limit.')
		}
		chunks.push(next.value)
	}
	if (!size) throw new Error('No recording supplied.')
	const body = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) {
		body.set(chunk, offset)
		offset += chunk.length
	}
	return body
}

export async function handleRecordingRequest(req: Request): Promise<Response> {
	try {
		const url = new URL(req.url)
		if (req.method === 'POST' && url.pathname === '/api/recordings') {
			const token = audienceToken(req.headers.get('cookie'))
			const roomId = url.searchParams.get('roomId') ?? ''
			const room = await liveRoom(roomId)
			if (!room.recordingsEnabled)
				return Response.json(
					{ error: 'Recordings are paused.' },
					{ status: 409 },
				)
			const trimStart = Number(url.searchParams.get('trimStart') || 0)
			const trimEnd = Number(url.searchParams.get('trimEnd') || 3)
			if (
				!Number.isFinite(trimStart) ||
				!Number.isFinite(trimEnd) ||
				trimStart < 0 ||
				trimEnd > 3 ||
				trimEnd - trimStart < 0.08
			)
				throw new Error('Choose a clip between 0.08 and 3 seconds.')
			const use = sampleUseSchema.parse(url.searchParams.get('use'))
			const requestId = req.headers.get('idempotency-key')
			if (!requestId || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId))
				return Response.json(
					{ error: 'Invalid recording request.' },
					{ status: 400 },
				)
			const existing = await prisma.recording.findUnique({
				where: {
					roomId_sessionToken_requestId: {
						roomId,
						sessionToken: token,
						requestId,
					},
				},
			})
			if (existing)
				return Response.json({ id: existing.id, status: existing.status })
			await mkdir(root, { recursive: true })
			const disk = await import('node:fs/promises').then((fs) =>
				fs.statfs(root),
			)
			if (disk.bavail * disk.bsize < 32 * 1024 * 1024)
				return Response.json(
					{ error: 'Recording storage is full.' },
					{ status: 503 },
				)
			const reservation = await prisma.$transaction(async (tx) => {
				const duplicate = await tx.recording.findUnique({
					where: {
						roomId_sessionToken_requestId: {
							roomId,
							sessionToken: token,
							requestId,
						},
					},
				})
				if (duplicate) return { recording: duplicate, created: false }
				const fresh = await tx.room.findUnique({ where: { id: roomId } })
				if (fresh?.status !== 'live' || !fresh.recordingsEnabled)
					throw new Error('Recordings are paused.')
				const pending = {
					in: [
						'uploading',
						'queued',
						'processing',
						'review',
						'ready',
						'preparing',
					],
				}
				if (
					await tx.recording.count({
						where: {
							roomId,
							sessionToken: token,
							OR: [
								{ status: pending },
								{ createdAt: { gt: new Date(Date.now() - 30_000) } },
							],
						},
					})
				)
					throw new Error(
						'Wait for your previous recording before sending another.',
					)
				if (
					(await tx.recording.count({ where: { roomId, status: pending } })) >=
					10
				)
					throw new Error('The room recording queue is full.')
				if ((await tx.recording.count({ where: { status: pending } })) >= 20)
					throw new Error('Recording processing is busy. Try again shortly.')
				return {
					created: true,
					recording: await tx.recording.create({
						data: {
							roomId,
							sessionToken: token,
							requestId,
							use,
							trimStart,
							trimEnd,
							status: 'uploading',
						},
					}),
				}
			})
			const recording = reservation.recording
			if (!reservation.created)
				return Response.json({ id: recording.id, status: recording.status })
			try {
				const body = await boundedBody(req)
				await Bun.write(filePath(recording.id, 'input'), body)
				await prisma.recording.updateMany({
					where: { id: recording.id, status: 'uploading' },
					data: { status: 'queued' },
				})
			} catch {
				await prisma.recording.updateMany({
					where: { id: recording.id, status: 'uploading' },
					data: {
						status: 'failed',
						reason: 'Upload interrupted. Record again.',
					},
				})
				throw new Error('Upload interrupted. Record again.')
			}
			void processRecordingQueue().catch((error) =>
				console.error('Recording queue failed', error),
			)
			notifyContributions(roomId)
			return Response.json(
				{ id: recording.id, status: 'queued' },
				{ status: 202 },
			)
		}
		if (req.method === 'GET') {
			const id = url.pathname.split('/').at(-1) ?? ''
			const roomId = url.searchParams.get('roomId') ?? ''
			const expires = url.searchParams.get('expires') ?? ''
			const provided = Buffer.from(url.searchParams.get('signature') ?? '')
			const expected = Buffer.from(signature(id, roomId, expires))
			if (
				!Number.isFinite(Number(expires)) ||
				Number(expires) < Date.now() ||
				expected.length !== provided.length ||
				!timingSafeEqual(provided, expected)
			)
				return new Response('Expired recording access', { status: 403 })
			const recording = await prisma.recording.findFirst({
				where: {
					id,
					roomId,
					status: { in: ['review', 'ready', 'preparing', 'applied'] },
					room: { status: 'live', recordingsEnabled: true },
				},
			})
			if (!recording)
				return new Response('Recording unavailable', { status: 404 })
			const file = Bun.file(filePath(id))
			if (!(await file.exists()))
				return new Response('Recording unavailable', { status: 404 })
			return new Response(file, {
				headers: {
					'content-type': 'audio/wav',
					'cache-control': 'private, no-store',
				},
			})
		}
		return new Response('Method not allowed', { status: 405 })
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : 'Recording failed.' },
			{ status: 400 },
		)
	}
}

export async function recoverRecordings(): Promise<void> {
	await mkdir(root, { recursive: true })
	await prisma.recording.updateMany({
		where: { status: 'processing' },
		data: { status: 'queued' },
	})
	await prisma.recording.updateMany({
		where: { status: 'uploading' },
		data: { status: 'failed', reason: 'Upload interrupted. Record again.' },
	})
	await cleanupRecordings()
	void processRecordingQueue().catch((error) =>
		console.error('Recording recovery failed', error),
	)
}
export async function cleanupRecordings(): Promise<void> {
	const grace = Number(process.env.RECORDINGS_RETENTION_HOURS || 24) * 3_600_000
	const cutoff = new Date(
		Date.now() - (Number.isFinite(grace) && grace >= 0 ? grace : 86_400_000),
	)
	const expired = await prisma.recording.findMany({
		where: {
			OR: [
				{ status: { in: ['withdrawn', 'failed', 'rejected'] } },
				{
					room: { status: { in: ['ended', 'outro'] }, endedAt: { lt: cutoff } },
				},
			],
		},
	})
	for (const recording of expired) {
		await rm(filePath(recording.id), { force: true })
		await rm(filePath(recording.id, 'input'), { force: true })
		if (!terminal.includes(recording.status))
			await prisma.recording.update({
				where: { id: recording.id },
				data: { status: 'expired' },
			})
	}
	for (const file of await readdir(root)) {
		const id = file.split('.')[0]
		if (!/^[a-z0-9]+\.(wav|input)$/i.test(file)) continue
		if (
			(await stat(resolve(root, file))).mtimeMs < cutoff.getTime() &&
			!(await prisma.recording.findUnique({ where: { id } }))
		)
			await rm(resolve(root, file), { force: true })
	}
}
