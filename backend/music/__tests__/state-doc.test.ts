import { expect, test } from 'bun:test'
import {
	applyChange,
	initialStateDoc,
	type StateDoc,
} from '@backend/music/state-doc'

const params = { genre: 'techno', bpm: 132 }

test('initialStateDoc: zero-history doc carries genre and bpm', () => {
	const doc = initialStateDoc(params)
	expect(doc.genre).toBe('techno')
	expect(doc.bpm).toBe(132)
	expect(doc.history).toEqual([])
	expect(doc.polledDimensions).toEqual([])
	expect(doc.elements).toEqual({
		drums: false,
		bass: false,
		melody: false,
		harmony: false,
		soundDesign: [],
	})
})

test('applyChange: appends history entry with winner and change summary', () => {
	const next = applyChange(
		initialStateDoc(params),
		'Add a punchier kick?',
		'yes',
		'added a punchier four-on-the-floor kick',
	)

	expect(next.history).toHaveLength(1)
	expect(next.history[0]).toMatchObject({
		question: 'Add a punchier kick?',
		winner: 'yes',
		changeSummary: 'added a punchier four-on-the-floor kick',
	})
	expect(typeof next.history[0]?.at).toBe('number')
})

test('applyChange: records polled dimension and marks the changed element', () => {
	const next = applyChange(
		initialStateDoc(params),
		'Add a punchier kick?',
		'yes',
		'added a punchier kick',
	)

	expect(next.polledDimensions).toEqual(['Add a punchier kick?'])
	expect(next.elements.drums).toBe(true)
	expect(next.elements.bass).toBe(false)
	expect(next.elements.melody).toBe(false)
	expect(next.elements.harmony).toBe(false)
})

test('applyChange: sound-design change lands in soundDesign list', () => {
	const next = applyChange(
		initialStateDoc(params),
		'Add more space?',
		'yes',
		'added a shimmering reverb texture',
	)

	expect(next.elements.soundDesign).toEqual([
		'added a shimmering reverb texture',
	])
	expect(next.elements.drums).toBe(false)
})

test('applyChange: accumulative over successive polls', () => {
	let doc: StateDoc = initialStateDoc(params)
	doc = applyChange(doc, 'Add a punchier kick?', 'yes', 'added a punchier kick')
	doc = applyChange(doc, 'Add bass?', 'no', null)
	doc = applyChange(doc, 'Add chords?', 'yes', 'added warm pad chords')

	expect(doc.history).toHaveLength(3)
	expect(doc.history[1]?.changeSummary).toBeNull()
	expect(doc.polledDimensions).toEqual([
		'Add a punchier kick?',
		'Add bass?',
		'Add chords?',
	])
	expect(doc.elements.drums).toBe(true)
	expect(doc.elements.bass).toBe(false)
	expect(doc.elements.harmony).toBe(true)
})

test('applyChange: null change summary leaves elements untouched', () => {
	const doc = initialStateDoc(params)
	const next = applyChange(doc, 'Add bass?', 'no', null)

	expect(next.history[0]?.changeSummary).toBeNull()
	expect(next.elements).toEqual(doc.elements)
})

test('applyChange is immutable', () => {
	const doc = initialStateDoc(params)
	const next = applyChange(doc, 'Add chords?', 'yes', 'added warm pad chords')

	expect(doc.history).toEqual([])
	expect(doc.polledDimensions).toEqual([])
	expect(doc.elements.harmony).toBe(false)
	expect(doc.elements.soundDesign).toEqual([])

	expect(next).not.toBe(doc)
	expect(next.elements).not.toBe(doc.elements)
	expect(next.elements.soundDesign).not.toBe(doc.elements.soundDesign)
	expect(next.history).not.toBe(doc.history)
	expect(next.polledDimensions).not.toBe(doc.polledDimensions)
})
