import type {
  ResearchClipRow,
  ResearchCollectionRow,
  ResearchFilingRow,
  ResearchSource,
  ResearchSourceKind,
  ResearchSourceRow,
} from '@folio/contracts'
import { RESEARCH_SOURCE_KIND_LABELS } from '@folio/contracts'

import { formatSceneRef } from '../characters/figures'

/**
 * The Research route's derived fields - `Route - Research v2.dc.html`'s
 * `renderVals()` over real rows. Pure, and tested in
 * `tests/research-view.test.ts`.
 *
 * The mockup's `data()` carries a snippet, a byline and a `meta` line per
 * source as fixture text. None of those is a column: the snippet is the
 * body's first paragraph cut to a line, the byline is the note, and the
 * mono line under a card is the origin with the body's word count. The
 * highlight spans in the source view are found here too - a clip stores
 * the line it was cut from, and the body is searched for it at read, so an
 * edited body that still contains the line keeps its highlight and one
 * that no longer does simply shows the clip in the list without one.
 */

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** The body as paragraphs: split on line breaks, trimmed, blanks dropped. */
export const paragraphsOf = (body: string): readonly string[] =>
  body
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

export const wordsOf = (body: string): number => {
  const trimmed = body.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

export const SNIPPET_MAX = 160

/** A line of text at most `max` long, cut at a word and marked with an ellipsis. */
export const cutToLine = (text: string, max = SNIPPET_MAX): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The card's two-line summary: the body's first paragraph, else the note, else nothing. */
export const snippetOf = (source: ResearchSource): string => {
  const first = paragraphsOf(source.body)[0]
  if (first !== undefined) return cutToLine(first)
  return source.note === null ? '' : cutToLine(source.note)
}

/** The line under the source page's title: the note, else the origin. `null` draws no line. */
export const bylineOf = (source: ResearchSource): string | null => source.note ?? source.origin

/**
 * The card's mono line: `Scroll.in · 2,400 words`, `own`, or the kind's
 * label when a source has neither an origin nor any text.
 */
export const cardLine = (source: ResearchSource): string => {
  const words = wordsOf(source.body)
  const parts = [source.origin, words > 0 ? `${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'}` : null].filter(
    (part): part is string => part !== null,
  )
  return parts.length === 0 ? RESEARCH_SOURCE_KIND_LABELS[source.kind] : parts.join(' · ')
}

/** The drawer's meta line: `Interview · added 3 weeks ago`. `added` is `relativeTime`'s. */
export const drawerMeta = (kind: ResearchSourceKind, added: string): string =>
  `${RESEARCH_SOURCE_KIND_LABELS[kind]} · added ${added}`

/** The source page's `kind · collection` line; `Unfiled` when it is in no collection. */
export const sourceKindLine = (source: ResearchSource): string =>
  `${RESEARCH_SOURCE_KIND_LABELS[source.kind]} · ${source.collection?.name ?? 'Unfiled'}`

/** A clip card's mono source line: `Interview · Sunita Pawar on the queue`. */
export const clipSourceLine = (source: Pick<ResearchSource, 'kind' | 'title'>): string =>
  `${RESEARCH_SOURCE_KIND_LABELS[source.kind]} · ${source.title}`

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

/** One run of a paragraph: plain, or the highlighted line of a clip. */
export type Part = {
  readonly text: string
  readonly clipId: ResearchClipRow['id'] | null
}

/**
 * The body's paragraphs with each clip's first occurrence marked. A clip
 * is marked once; a clip whose text spans two paragraphs, or is no longer
 * in the body, marks nothing. Overlapping clips keep the earlier-cut one.
 */
export const highlightParagraphs = (body: string, clips: readonly Pick<ResearchClipRow, 'id' | 'text'>[]): readonly (readonly Part[])[] => {
  const paragraphs = paragraphsOf(body)
  const ranges: { start: number; end: number; clipId: ResearchClipRow['id'] }[][] = paragraphs.map(() => [])

  for (const clip of clips) {
    const needle = clip.text.trim()
    if (needle === '') continue
    for (let p = 0; p < paragraphs.length; p += 1) {
      const paragraph = paragraphs[p]
      const own = ranges[p]
      if (paragraph === undefined || own === undefined) continue
      let from = 0
      let placed = false
      while (!placed) {
        const start = paragraph.indexOf(needle, from)
        if (start < 0) break
        const end = start + needle.length
        if (own.every((range) => end <= range.start || start >= range.end)) {
          own.push({ start, end, clipId: clip.id })
          placed = true
        } else {
          from = start + 1
        }
      }
      if (placed) break
    }
  }

  return paragraphs.map((paragraph, p) => {
    const own = [...(ranges[p] ?? [])].sort((a, b) => a.start - b.start)
    if (own.length === 0) return [{ text: paragraph, clipId: null }]
    const parts: Part[] = []
    let cursor = 0
    for (const range of own) {
      if (range.start > cursor) parts.push({ text: paragraph.slice(cursor, range.start), clipId: null })
      parts.push({ text: paragraph.slice(range.start, range.end), clipId: range.clipId })
      cursor = range.end
    }
    if (cursor < paragraph.length) parts.push({ text: paragraph.slice(cursor), clipId: null })
    return parts
  })
}

// ---------------------------------------------------------------------------
// Filings
// ---------------------------------------------------------------------------

/**
 * A filing chip's text. A scene is its ref alone (`E1 Sc 3`), as every
 * scene reference on the record routes reads; a record is `Kind · Name`,
 * the shape the mockup's `Bible · Kadam` chip has. A scene whose heading
 * has left the script says so rather than printing a node id.
 */
export const filingLabel = (filing: ResearchFilingRow): string => {
  switch (filing.kind) {
    case 'character':
      return `Character · ${filing.name}`
    case 'location':
      return `Location · ${filing.name}`
    case 'scene':
      return filing.ref === null ? 'Scene · not in the script' : formatSceneRef(filing.ref)
  }
}

export const isFiled = (clip: Pick<ResearchClipRow, 'filings'>): boolean => clip.filings.length > 0

export const filedCount = (clips: readonly Pick<ResearchClipRow, 'filings'>[]): number => clips.filter(isFiled).length

/** The sidebar widget: `4 / 7`, the bar's percent, and `3 clips not filed yet`. */
export const filedWidget = (
  clips: readonly Pick<ResearchClipRow, 'filings'>[],
): { readonly label: string; readonly percent: number; readonly note: string } => {
  const filed = filedCount(clips)
  const total = clips.length
  const left = total - filed
  return {
    label: `${String(filed)} / ${String(total)}`,
    percent: total === 0 ? 0 : Math.round((filed / total) * 100),
    note: total === 0 ? 'No clips yet' : left === 0 ? 'Every clip is filed' : `${String(left)} ${left === 1 ? 'clip' : 'clips'} not filed yet`,
  }
}

// ---------------------------------------------------------------------------
// Counts and lines
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`

/** The toolbar's count chip: what the view counts. */
export const countChip = (view: 'library' | 'source' | 'clips', shown: number, clips: number): string =>
  view === 'clips' ? plural(clips, 'clip', 'clips') : plural(shown, 'source', 'sources')

/** The status bar's left half. */
export const statusLeft = (
  projectTitle: string,
  sources: readonly ResearchSourceRow[],
  collections: readonly ResearchCollectionRow[],
  clips: readonly ResearchClipRow[],
): string =>
  sources.length === 0
    ? `${projectTitle} · research empty`
    : `${plural(sources.length, 'source', 'sources')} · ${plural(collections.length, 'collection', 'collections')} · ${plural(clips.length, 'clip', 'clips')}`

/** The mono route path on the status bar's right. */
export const statusPath = (view: 'library' | 'source' | 'clips', sourceId: string | null): string =>
  view === 'source' && sourceId !== null ? `research/${sourceId}` : view === 'clips' ? 'research/clips' : 'research'

/** The `❝ N clips` count beside a source's title. */
export const clipsLabel = (n: number): string => plural(n, 'clip', 'clips')

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type KindFilter = 'all' | ResearchSourceKind

export const kindFilterLabel = (filter: KindFilter): string => (filter === 'all' ? 'All types' : RESEARCH_SOURCE_KIND_LABELS[filter])

/** The sidebar's find field over the library: title, origin, note and body. */
export const sourceMatches = (source: ResearchSource, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return [source.title, source.origin ?? '', source.note ?? '', source.body].some((field) => field.toLowerCase().includes(needle))
}

/** The same field over the clips list: the line itself. */
export const clipMatches = (clip: Pick<ResearchClipRow, 'text'>, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  return needle === '' || clip.text.toLowerCase().includes(needle)
}

export const filterSources = (
  sources: readonly ResearchSourceRow[],
  collection: ResearchCollectionRow['id'] | 'all',
  kind: KindFilter,
  query: string,
): readonly ResearchSourceRow[] =>
  sources.filter(
    (source) =>
      (collection === 'all' || source.collection?.id === collection) && (kind === 'all' || source.kind === kind) && sourceMatches(source, query),
  )
