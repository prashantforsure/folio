// @vitest-environment node
import type { ResearchClipRow, ResearchCollectionRow, ResearchSourceRow } from '@folio/contracts'
import { episodeSlug, researchClipId, researchCollectionId, researchFilingId, researchSourceId } from '@folio/contracts'
import { characterId, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  bylineOf,
  cardLine,
  countChip,
  cutToLine,
  drawerMeta,
  filedWidget,
  filingLabel,
  filterSources,
  highlightParagraphs,
  paragraphsOf,
  snippetOf,
  sourceKindLine,
  statusLeft,
  statusPath,
  wordsOf,
} from '../lib/research/view'

/**
 * The mockup's `renderVals()` over rows: the derived lines a card, a source
 * page and the drawer print, the highlight spans, the widget and the status
 * bar. `Route - Research v2.dc.html`'s fixture is the sample.
 */

const collection: ResearchCollectionRow = { id: researchCollectionId('11111111-1111-4111-8111-111111111111'), name: 'Chawl life', colour: 'violet', sources: 1 }

const interview: ResearchSourceRow = {
  id: researchSourceId('22222222-2222-4222-8222-222222222222'),
  kind: 'interview',
  title: 'Sunita Pawar on the queue',
  origin: 'Recorded 14 Aug',
  note: 'Marathi, translated by AR. Minutes 6–14 transcribed; the rest is audio only.',
  body: [
    'We used to get water at six. Six to seven-thirty, if the pressure came.',
    '',
    "When it stopped, the tanker started. The tanker doesn't wait. If you're not down by the time the horn goes, that's your morning gone. People started leaving buckets at night.",
    "Two buckets. If you want a third you pay the boy forty rupees and you don't ask whose boy he is. Everyone knew.",
  ].join('\n'),
  collection: { id: collection.id, name: collection.name, colour: collection.colour },
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
  clips: 2,
}

const photos: ResearchSourceRow = {
  ...interview,
  id: researchSourceId('33333333-3333-4333-8333-333333333333'),
  kind: 'image',
  title: 'Chawl corridor reference · 14 photos',
  origin: null,
  note: null,
  body: '',
  collection: null,
  clips: 0,
}

const clip = (id: string, text: string, filings: ResearchClipRow['filings'] = []): ResearchClipRow => ({
  id: researchClipId(id),
  sourceId: interview.id,
  text,
  createdAt: '2026-08-21T10:00:00.000Z',
  filings,
})

const TANKER = "The tanker doesn't wait. If you're not down by the time the horn goes, that's your morning gone."
const BUCKETS = "Two buckets. If you want a third you pay the boy forty rupees and you don't ask whose boy he is."

describe('the text a card and a source page derive', () => {
  it('splits the body on line breaks and drops blanks', () => {
    expect(paragraphsOf(interview.body)).toHaveLength(3)
    expect(paragraphsOf('')).toEqual([])
    expect(wordsOf('')).toBe(0)
    expect(wordsOf('  two   words ')).toBe(2)
  })

  it('cuts a snippet at a word and marks it', () => {
    expect(cutToLine('short')).toBe('short')
    const long = 'word '.repeat(60).trim()
    const cut = cutToLine(long)
    expect(cut.length).toBeLessThanOrEqual(161)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut).not.toMatch(/ …$/)
  })

  it('takes the snippet from the body, then the note, then nothing', () => {
    expect(snippetOf(interview)).toBe('We used to get water at six. Six to seven-thirty, if the pressure came.')
    expect(snippetOf({ ...photos, note: 'Shot on the second floor.' })).toBe('Shot on the second floor.')
    expect(snippetOf(photos)).toBe('')
  })

  it('reads the byline from the note, else the origin', () => {
    expect(bylineOf(interview)).toBe(interview.note)
    expect(bylineOf({ ...interview, note: null })).toBe('Recorded 14 Aug')
    expect(bylineOf(photos)).toBeNull()
  })

  it('composes the mono line from the origin and the word count, else the kind', () => {
    expect(cardLine(interview)).toMatch(/^Recorded 14 Aug · \d+ words$/)
    expect(cardLine({ ...interview, body: 'one' })).toBe('Recorded 14 Aug · 1 word')
    expect(cardLine(photos)).toBe('Images')
    expect(drawerMeta('interview', '3 weeks ago')).toBe('Interview · added 3 weeks ago')
    expect(sourceKindLine(interview)).toBe('Interview · Chawl life')
    expect(sourceKindLine(photos)).toBe('Images · Unfiled')
  })
})

describe('highlights', () => {
  it('marks each clip once, at its first occurrence, and splits the paragraph around it', () => {
    const parts = highlightParagraphs(interview.body, [clip('a', TANKER), clip('b', BUCKETS)])
    expect(parts[0]).toEqual([{ text: 'We used to get water at six. Six to seven-thirty, if the pressure came.', clipId: null }])
    expect(parts[1]?.map((part) => part.clipId)).toEqual([null, researchClipId('a'), null])
    expect(parts[1]?.[1]?.text).toBe(TANKER)
    expect(parts[2]?.[0]).toEqual({ text: BUCKETS, clipId: researchClipId('b') })
  })

  it('leaves a clip whose line is no longer in the body unmarked, and keeps the earlier of two overlapping', () => {
    const parts = highlightParagraphs(interview.body, [clip('gone', 'not in the body'), clip('a', TANKER), clip('c', "tanker doesn't wait")])
    const marked = parts.flat().filter((part) => part.clipId !== null)
    expect(marked).toHaveLength(1)
    expect(marked[0]?.clipId).toBe(researchClipId('a'))
  })

  it('finds the same line twice only for two different clips', () => {
    const body = 'yes. yes.'
    const parts = highlightParagraphs(body, [clip('a', 'yes.'), clip('b', 'yes.')])
    expect(parts[0]?.map((part) => part.clipId)).toEqual([researchClipId('a'), null, researchClipId('b')])
  })
})

describe('filings', () => {
  const ref = { sceneNodeId: nodeId('44444444-4444-4444-8444-444444444444'), episode: episodeSlug('ep_001'), episodeOrdinal: 1, number: 3, heading: 'INT. CHAWL - DAWN' }

  it('labels a scene by its ref and a record by kind and name', () => {
    expect(filingLabel({ id: researchFilingId('f1'), kind: 'scene', sceneNodeId: ref.sceneNodeId, ref })).toBe('E1 Sc 3')
    expect(filingLabel({ id: researchFilingId('f2'), kind: 'scene', sceneNodeId: ref.sceneNodeId, ref: null })).toBe('Scene · not in the script')
    expect(filingLabel({ id: researchFilingId('f3'), kind: 'character', characterId: characterId('c'), name: 'Kadam' })).toBe('Character · Kadam')
    expect(filingLabel({ id: researchFilingId('f4'), kind: 'location', locationId: locationId('l'), name: 'Kamathi chawl' })).toBe('Location · Kamathi chawl')
  })

  it('counts the widget the way the mockup does', () => {
    const filed = clip('a', TANKER, [{ id: researchFilingId('f1'), kind: 'scene', sceneNodeId: ref.sceneNodeId, ref }])
    expect(filedWidget([filed, clip('b', BUCKETS), clip('c', 'x')])).toEqual({ label: '1 / 3', percent: 33, note: '2 clips not filed yet' })
    expect(filedWidget([filed])).toEqual({ label: '1 / 1', percent: 100, note: 'Every clip is filed' })
    expect(filedWidget([])).toEqual({ label: '0 / 0', percent: 0, note: 'No clips yet' })
  })
})

describe('the toolbar, the status bar and the filters', () => {
  it('counts what the view shows', () => {
    expect(countChip('library', 8, 7)).toBe('8 sources')
    expect(countChip('library', 1, 7)).toBe('1 source')
    expect(countChip('clips', 8, 7)).toBe('7 clips')
    expect(countChip('source', 3, 1)).toBe('3 sources')
  })

  it("writes the status bar in the mockup's two shapes", () => {
    expect(statusLeft('Monsoon Line', [], [], [])).toBe('Monsoon Line · research empty')
    expect(statusLeft('Monsoon Line', [interview, photos], [collection], [clip('a', 'x')])).toBe('2 sources · 1 collection · 1 clip')
    expect(statusPath('library', null)).toBe('research')
    expect(statusPath('clips', null)).toBe('research/clips')
    expect(statusPath('source', interview.id)).toBe(`research/${interview.id}`)
  })

  it('narrows by collection, kind and the find query together', () => {
    const all = [interview, photos]
    expect(filterSources(all, 'all', 'all', '')).toEqual(all)
    expect(filterSources(all, collection.id, 'all', '')).toEqual([interview])
    expect(filterSources(all, 'all', 'image', '')).toEqual([photos])
    expect(filterSources(all, 'all', 'all', 'corridor')).toEqual([photos])
    expect(filterSources(all, 'all', 'all', 'TANKER')).toEqual([interview])
    expect(filterSources(all, collection.id, 'image', '')).toEqual([])
  })
})
