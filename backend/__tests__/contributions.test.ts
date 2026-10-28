process.env.DATABASE_URL = 'file:./contributions-test.db'
import { afterAll, afterEach, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLlmProvider } from '@backend/llm/provider'
import { musicalIntentSchema } from '@shared/schemas/contributions'

execSync(
	'DATABASE_URL=file:./contributions-test.db bun x --no-install prisma migrate deploy',
	{ stdio: 'pipe' },
)
const { prisma } = await import('@backend/db/client')
const {
	previewDirection,
	submitDirection,
	readDirectionContext,
	contextValid,
	invalidateContributions,
	resolveContributionContext,
} = await import('@backend/contributions')
const { ensurePreferenceQuestions, readCrowdQuestions } =
	await import('@backend/votes/preferences')
const { castVote } = await import('@backend/votes/service')
const recordingsDirectory = await mkdtemp(
	join(tmpdir(), 'music-vote-recordings-test-'),
)
process.env.RECORDINGS_DIR = recordingsDirectory
const { prepareRecording, handleRecordingRequest, samplePlayback } =
	await import('@backend/recordings')
const users: string[] = []
async function room() {
	const user = await prisma.user.create({
		data: { email: `${crypto.randomUUID()}@example.com`, name: 'Host' },
	})
	users.push(user.id)
	return prisma.room.create({
		data: {
			hostId: user.id,
			status: 'live',
			bpm: 120,
			genre: 'house',
			lengthSec: 600,
			pollIntervalSec: 60,
			stateDoc: {},
		},
	})
}
afterEach(async () => {
	await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } })
})
afterAll(async () => {
	await prisma.$disconnect()
	await rm(recordingsDirectory, { recursive: true, force: true })
})
const intent = {
	kind: 'preference',
	targets: [{ dimension: 'bass', choice: 'bouncy' }],
}

test('legacy question upgrade preserves answers and adds missing dimensions once', async () => {
	const r = await room()
	const poll = await prisma.poll.create({
		data: {
			roomId: r.id,
			seq: 1,
			kind: 'preference',
			question: 'What energy feels right?',
			status: 'open',
			options: [{ key: 'mellow', label: 'Mellow' }],
		},
	})
	await castVote(poll.id, 'phone', 'mellow')
	await ensurePreferenceQuestions(r.id)
	await ensurePreferenceQuestions(r.id)
	const questions = await readCrowdQuestions(r.id, 'phone')
	expect(questions).toHaveLength(7)
	expect(questions[0]?.choice).toBe('mellow')
	await castVote(poll.id, 'phone', null)
	expect((await readCrowdQuestions(r.id, 'phone'))[0]?.choice).toBeNull()
	expect((await readCrowdQuestions(r.id))[0]?.counts.mellow).toBe(0)
})
test('review is bound to its phone, activation is idempotent, and immutable revisions are retained', async () => {
	const r = await room()
	const preview = await previewDirection(
		r.id,
		'a',
		'Make the bass bounce',
		new MockLlmProvider([JSON.stringify(intent)]),
	)
	await expect(submitDirection(r.id, 'b', preview.reviewToken)).rejects.toThrow(
		'Review this direction again',
	)
	await submitDirection(r.id, 'a', preview.reviewToken)
	await submitDirection(r.id, 'a', preview.reviewToken)
	const context = await readDirectionContext(r.id)
	expect(context.directions).toHaveLength(1)
	expect(context.directions[0]?.revision).toBe(1)
	expect(await prisma.directionRevision.count()).toBe(1)
	expect(JSON.stringify(context)).not.toContain('Make the bass bounce')
	expect(context.directions[0]?.intent.targets).toEqual(intent.targets)
	await expect(
		submitDirection(r.id, 'a', `${preview.reviewToken}tampered`),
	).rejects.toThrow()
})
test('arbitrary code and unsupported dimensions cannot enter interpreted musical targets', () => {
	expect(
		musicalIntentSchema.safeParse({
			kind: 'preference',
			targets: [{ dimension: 'code', choice: 'fetch("evil")' }],
		}).success,
	).toBe(false)
	expect(
		musicalIntentSchema.safeParse({
			kind: 'preference',
			targets: [...intent.targets, ...intent.targets],
		}).success,
	).toBe(false)
})
test('withdrawal invalidates a referenced candidate and prevents confirmation', async () => {
	const r = await room()
	const preview = await previewDirection(
		r.id,
		'a',
		'Underwater',
		new MockLlmProvider([JSON.stringify(intent)]),
	)
	await submitDirection(r.id, 'a', preview.reviewToken)
	const context = await readDirectionContext(r.id)
	const update = await prisma.poll.create({
		data: {
			roomId: r.id,
			seq: 1,
			kind: 'crowd',
			question: 'Crowd',
			options: [],
			context,
			status: 'closed',
			deliveryStatus: 'preparing',
		},
	})
	const candidate = await prisma.patternVersion.create({
		data: {
			roomId: r.id,
			source: update.id,
			code: 's("bd")',
			status: 'candidate',
			context,
		},
	})
	await prisma.direction.updateMany({
		where: { roomId: r.id },
		data: { status: 'withdrawn' },
	})
	await invalidateContributions(r.id, context.directions[0]!.id)
	expect(
		(
			await prisma.patternVersion.findUniqueOrThrow({
				where: { id: candidate.id },
			})
		).status,
	).toBe('rejected')
	expect(
		await prisma.$transaction((tx) => contextValid(tx, r.id, context)),
	).toBe(false)
})
test('only confirmed sample delivery starts its eight-bar lifetime; duplicate outcomes do not extend it', async () => {
	const r = await room()
	await prisma.room.update({
		where: { id: r.id },
		data: { recordingsEnabled: true },
	})
	const clip = await prisma.recording.create({
		data: {
			roomId: r.id,
			sessionToken: 'a',
			requestId: 'sample',
			use: 'hook',
			status: 'preparing',
		},
	})
	const context = { directions: [], recordingId: clip.id }
	expect(
		await prisma.$transaction((tx) => contextValid(tx, r.id, context)),
	).toBe(true)
	const now = new Date()
	await prisma.$transaction((tx) =>
		resolveContributionContext(tx, r.id, context, 'applied', now),
	)
	await prisma.$transaction((tx) =>
		resolveContributionContext(
			tx,
			r.id,
			context,
			'applied',
			new Date(now.getTime() + 5000),
		),
	)
	const applied = await prisma.recording.findUniqueOrThrow({
		where: { id: clip.id },
	})
	expect(applied.expiresAt?.getTime()).toBe(now.getTime() + 16000)
	expect(
		await prisma.$transaction((tx) => contextValid(tx, r.id, context)),
	).toBe(false)
})

function wave(silent = false): Uint8Array {
	const samples = 12000
	const bytes = new Uint8Array(44 + samples * 2)
	const data = new DataView(bytes.buffer)
	for (const [at, tag] of [
		[0, 'RIFF'],
		[8, 'WAVE'],
		[12, 'fmt '],
		[36, 'data'],
	] as const)
		for (let i = 0; i < tag.length; i++) bytes[at + i] = tag.charCodeAt(i)
	data.setUint32(4, bytes.length - 8, true)
	data.setUint32(16, 16, true)
	data.setUint16(20, 1, true)
	data.setUint16(22, 1, true)
	data.setUint32(24, 24000, true)
	data.setUint32(28, 48000, true)
	data.setUint16(32, 2, true)
	data.setUint16(34, 16, true)
	data.setUint32(40, samples * 2, true)
	for (let i = 0; i < samples; i++)
		data.setInt16(
			44 + i * 2,
			silent ? 0 : Math.sin((i * Math.PI * 2 * 440) / 24000) * 8000,
			true,
		)
	return bytes
}
test('audio processing decodes real WAV, WebM and MP4 clips, rejects silence and invalid bytes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'music-vote-audio-'))
	try {
		const input = join(directory, 'input.wav')
		await Bun.write(input, wave())
		const normalized = join(directory, 'normalized.wav')
		expect(await prepareRecording(input, normalized)).toBeGreaterThan(0.1)
		for (const [extension, codec] of [
			['webm', 'libopus'],
			['m4a', 'aac'],
		]) {
			const converted = join(directory, `input.${extension}`)
			const child = Bun.spawn(
				[
					'ffmpeg',
					'-nostdin',
					'-loglevel',
					'error',
					'-i',
					input,
					'-c:a',
					codec!,
					'-y',
					converted,
				],
				{ stdout: 'ignore', stderr: 'ignore' },
			)
			expect(await child.exited).toBe(0)
			expect(await prepareRecording(converted, normalized)).toBeGreaterThan(0.1)
		}
		await Bun.write(input, wave(true))
		await expect(prepareRecording(input, normalized)).rejects.toThrow()
		await Bun.write(input, 'invalid bytes')
		await expect(prepareRecording(input, normalized)).rejects.toThrow()
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}, 20000)

test('binary uploads are bounded and idempotent; sample access is room-scoped and revocable', async () => {
	const r = await room()
	await prisma.room.update({
		where: { id: r.id },
		data: { recordingsEnabled: true },
	})
	const upload = (
		requestId: string,
		body: Uint8Array,
		token = 'upload-phone',
	) =>
		handleRecordingRequest(
			new Request(
				`http://localhost/api/recordings?roomId=${r.id}&use=percussion`,
				{
					method: 'POST',
					headers: {
						cookie: `mv_session=${token}`,
						'idempotency-key': requestId,
					},
					body: new Uint8Array(body).buffer,
				},
			),
		)
	const large = await upload(
		'too-large',
		new Uint8Array(2 * 1024 * 1024 + 1),
		'large-phone',
	)
	expect(large.status).toBe(400)
	const responses = await Promise.all([
		upload('same-clip', wave()),
		upload('same-clip', wave()),
	])
	const bodies = await Promise.all(
		responses.map((r) => r.json() as Promise<{ id: string }>),
	)
	expect(bodies[0]?.id).toBe(bodies[1]?.id)
	expect(
		await prisma.recording.count({
			where: { roomId: r.id, requestId: 'same-clip' },
		}),
	).toBe(1)
	let recording = await prisma.recording.findUniqueOrThrow({
		where: { id: bodies[0]!.id },
	})
	for (
		let i = 0;
		i < 100 && !['review', 'failed'].includes(recording.status);
		i++
	) {
		await new Promise((resolve) => setTimeout(resolve, 20))
		recording = await prisma.recording.findUniqueOrThrow({
			where: { id: recording.id },
		})
	}
	expect(recording.status).toBe('review')
	const sample = samplePlayback(recording, 120)
	expect(
		(await handleRecordingRequest(new Request(`http://localhost${sample.url}`)))
			.status,
	).toBe(200)
	expect(
		(
			await handleRecordingRequest(
				new Request(
					`http://localhost${sample.url.replace(r.id, 'wrong-room')}`,
				),
			)
		).status,
	).toBe(403)
	await prisma.recording.update({
		where: { id: recording.id },
		data: { status: 'withdrawn' },
	})
	expect(
		(await handleRecordingRequest(new Request(`http://localhost${sample.url}`)))
			.status,
	).toBe(404)
}, 10000)
