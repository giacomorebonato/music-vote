export type MusicParams = { genre: string; bpm: number }

type StateDocElements = {
	drums: boolean
	bass: boolean
	melody: boolean
	harmony: boolean
	soundDesign: string[]
}

type StateDocHistoryEntry = {
	at: number
	question: string
	winner: string
	changeSummary: string | null
}

export type StateDoc = {
	genre: string
	bpm: number
	elements: StateDocElements
	history: StateDocHistoryEntry[]
	polledDimensions: string[]
	crowdHistory?: {
		at: number
		snapshot: import('@shared/schemas/preferences').CrowdSnapshot
	}[]
}

// Zero-history doc for a freshly started room: no poll has been applied yet, so
// every element starts absent and nothing has been polled.
export function initialStateDoc(params: MusicParams): StateDoc {
	return {
		genre: params.genre,
		bpm: params.bpm,
		elements: {
			drums: false,
			bass: false,
			melody: false,
			harmony: false,
			soundDesign: [],
		},
		history: [],
		polledDimensions: [],
	}
}

const SOUND_DESIGN_PATTERN = /sound|texture|fx|filter|noise|reverb|delay/

// The only signal about what changed is the free-text summary the LLM reports,
// so element presence is inferred from its wording.
function nextElements(
	elements: StateDocElements,
	changeSummary: string | null,
): StateDocElements {
	const text = (changeSummary ?? '').toLowerCase()
	const addsSoundDesign =
		changeSummary !== null && SOUND_DESIGN_PATTERN.test(text)
	return {
		drums: elements.drums || /drum|kick|snare|hat|perc/.test(text),
		bass: elements.bass || /bass|sub/.test(text),
		melody: elements.melody || /melod|lead|arp|riff|hook/.test(text),
		harmony: elements.harmony || /harmon|chord|pad|stab/.test(text),
		soundDesign: addsSoundDesign
			? [...elements.soundDesign, changeSummary]
			: [...elements.soundDesign],
	}
}

// Immutable: returns a new doc (callers persist it straight to Room.stateDoc),
// appending the poll to history and recording the polled dimension.
export function applyChange(
	doc: StateDoc,
	question: string,
	winner: string,
	changeSummary: string | null,
): StateDoc {
	return {
		...doc,
		elements: nextElements(doc.elements, changeSummary),
		history: [
			...doc.history,
			{ at: Date.now(), question, winner, changeSummary },
		],
		polledDimensions: [...doc.polledDimensions, question],
	}
}
