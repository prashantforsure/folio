import type {
  AliasProvenance,
  CastRow,
  CharacterColor,
  CharacterMap,
  CharacterProfile,
  CharacterStatus,
  ExchangeRow,
  ResolveItem,
  SceneFacts,
  SceneRef,
} from '@folio/contracts'
import { CHARACTER_COLORS } from '@folio/contracts'
import type { CharacterId, DeliveryModifier, MatchReason, NodeId, Presence } from '@folio/script'
import { canonicalKey, readCue } from '@folio/script'

import { sumEighths } from '../locations/figures'
import { thousands } from '../workspace/format'

/**
 * The derived fields the Characters route prints, each a pure function
 * over the rows the loader joins, computed from the real tables rather
 * than authored. Tested in `tests/characters-cast.test.ts`.
 *
 * Nothing here estimates and nothing calls a model. A per-episode count is
 * arithmetic over `character_derivations.scenes` joined to the scene index;
 * a group is a threshold over scene counts; a conflict is an open row in
 * the resolve queue; a presence strip is one cell per scene of the index;
 * a share is words over words. AGENTS.md, UI fidelity: every number is
 * "computed from the script".
 *
 * The force graph and its layout left with the Relationships view (ruled
 * 2026-09-17: replaced by the Presence view); `neverShare` stays because
 * the finding card and the assistant's report chip still count it.
 */

// ---------------------------------------------------------------------------
// Scenes: per episode, first and last
// ---------------------------------------------------------------------------

/** The scene refs a character is in, in script order, from its heading ids. */
export const refsOf = <R extends SceneRef>(scenes: readonly NodeId[], refs: ReadonlyMap<NodeId, R>): readonly R[] =>
  scenes
    .flatMap((id) => {
      const ref = refs.get(id)
      return ref === undefined ? [] : [ref]
    })
    .sort((a, b) => a.episodeOrdinal - b.episodeOrdinal || a.number - b.number)

/**
 * How many of the character's scenes fall in each episode, in episode
 * order - the README's episode bars. Every episode gets a slot, so an
 * episode the character is absent from is a `0` and draws `--line2`.
 */
export const perEpisode = (
  scenes: readonly NodeId[],
  refs: ReadonlyMap<NodeId, SceneRef>,
  episodeOrdinals: readonly number[],
): readonly number[] => {
  const counts = new Map<number, number>(episodeOrdinals.map((ordinal) => [ordinal, 0]))
  for (const ref of refsOf(scenes, refs)) {
    const seen = counts.get(ref.episodeOrdinal)
    if (seen !== undefined) counts.set(ref.episodeOrdinal, seen + 1)
  }
  return episodeOrdinals.map((ordinal) => counts.get(ordinal) ?? 0)
}

/** `E1 Sc 1 → E3 Sc 30`; null with no scene. */
export const firstLast = <R extends SceneRef>(
  scenes: readonly NodeId[],
  refs: ReadonlyMap<NodeId, R>,
): { readonly first: R; readonly last: R } | null => {
  const ordered = refsOf(scenes, refs)
  const first = ordered[0]
  const last = ordered.at(-1)
  return first === undefined || last === undefined ? null : { first, last }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * `79 scenes`, `1 scene`, `0 scenes`. A count that legitimately reaches zero
 * prints the zero (README, "Empty meta"); `Not on the page yet` is the
 * citation line's phrase and the sidebar group's, not a number's.
 */
export const sceneLabel = (appearances: number): string =>
  appearances === 1 ? '1 scene' : `${String(appearances)} scenes`

/**
 * Why the queue is asking - the branch `compare` took, in the writer's words.
 * `same name` for an exact key under an unbound spelling; `first name` when
 * the shorter key is one token, else `starts the same`; `contains MEERA` for
 * a contained key; `2 letters off` for an edit distance.
 */
export const reasonLabel = (reason: MatchReason): string => {
  switch (reason.kind) {
    case 'exact':
      return 'same name'
    case 'leading':
      return reason.shorter.includes(' ') ? 'starts the same' : 'first name'
    case 'contains':
      return `contains ${reason.inner}`
    case 'edits':
      return `${String(reason.distance)} ${reason.distance === 1 ? 'letter' : 'letters'} off`
  }
}

/** Past this many open rows the queue folds to the first five with `Show all N`. */
export const QUEUE_FOLD = 5

/**
 * The status bar's route id: `characters`, or `characters/3f2a9c1e` with a
 * drawer open - the record's id cut to its first eight characters so a
 * 36-character UUID does not fill the bar. Locations and Research still
 * print the whole id.
 */
export const routeIdOf = (selected: { readonly id: string } | null): string =>
  selected === null ? 'characters' : `characters/${selected.id.slice(0, 8)}`

/** The sidebar foot: how many records the script holds, of how many exist. */
export const onPageOf = (
  rows: readonly { readonly presence: Presence }[],
): { readonly present: number; readonly total: number } => ({
  present: rows.filter((row) => row.presence === 'present').length,
  total: rows.length,
})

/**
 * The colour a new record takes: the first of the ten nobody has, else the
 * least used. Chosen at creation and changed from the drawer's swatches.
 */
export const leastUsedColor = (hues: readonly number[]): CharacterColor => {
  const counts = new Map<number, number>()
  for (const hue of hues) counts.set(hue, (counts.get(hue) ?? 0) + 1)
  let best: CharacterColor = CHARACTER_COLORS[0].id
  let fewest = Number.POSITIVE_INFINITY
  for (const color of CHARACTER_COLORS) {
    const used = counts.get(color.hue) ?? 0
    if (used < fewest) {
      fewest = used
      best = color.id
    }
  }
  return best
}

/**
 * The drawer's stats row: `412 lines · 3,180 words · 14% of dialogue ·
 * 3 V.O.` - the share against every dialogue word in the project, V.O.
 * counted from the cue variants whose modifiers carry it. Off the page it
 * is the honest zero: `0 lines · 0 words`.
 */
export const statsLine = (
  figure: Pick<CastRow, 'lines' | 'words' | 'cues'>,
  projectWords: number,
): string => {
  const parts = [
    `${thousands(figure.lines)} ${figure.lines === 1 ? 'line' : 'lines'}`,
    `${thousands(figure.words)} ${figure.words === 1 ? 'word' : 'words'}`,
  ]
  if (projectWords > 0 && figure.words > 0) parts.push(`${String(shareOf(figure.words, projectWords))}% of dialogue`)
  const voiceOver = figure.cues.filter((cue) => readCue(cue.cue).modifiers.includes('V.O.')).reduce((total, cue) => total + cue.occurrences, 0)
  if (voiceOver > 0) parts.push(`${String(voiceOver)} V.O.`)
  return parts.join(' · ')
}

/** A percentage, whole, never above 100; `0` with nothing to share. */
export const shareOf = (words: number, total: number): number =>
  total <= 0 ? 0 : Math.min(100, Math.round((words / total) * 100))

// ---------------------------------------------------------------------------
// The alias table
// ---------------------------------------------------------------------------

/**
 * One row of the drawer's `In the script as`: a bound spelling and what the
 * script counts under its key. The tallies group by canonical key, so
 * `MEERA (V.O.)` is a *variant* of the `MEERA` row - the modifier is in the
 * spelling, read off at render with `readCue`, never a field of its own.
 */
export type AliasRow = {
  readonly cue: string
  readonly key: string
  readonly occurrences: number
  readonly lines: number
  /** Tallies under this key whose spelling carries a modifier: `V.O. 3`. */
  readonly variants: readonly {
    readonly cue: string
    readonly modifiers: readonly DeliveryModifier[]
    readonly occurrences: number
  }[]
  /** This spelling is the record's name. */
  readonly isName: boolean
  readonly provenance: AliasProvenance
  /** Some cue in the script uses this key; a bound spelling nothing uses yet is drawn dashed. */
  readonly counted: boolean
}

export const aliasRowsOf = (profile: Pick<CharacterProfile, 'name' | 'cues' | 'bound'>): readonly AliasRow[] => {
  const nameKey = canonicalKey(profile.name)
  return profile.bound.map((entry) => {
    const key = canonicalKey(readCue(entry.cue).name)
    const tallies = profile.cues.filter((tally) => tally.key === key)
    return {
      cue: entry.cue,
      key,
      occurrences: tallies.reduce((total, tally) => total + tally.occurrences, 0),
      lines: tallies.reduce((total, tally) => total + tally.lines, 0),
      variants: tallies.flatMap((tally) => {
        const modifiers = readCue(tally.cue).modifiers
        return modifiers.length === 0 ? [] : [{ cue: tally.cue, modifiers, occurrences: tally.occurrences }]
      }),
      isName: key === nameKey,
      provenance: entry.provenance,
      counted: tallies.length > 0,
    }
  })
}

/** The card's alias line: `MEERA 79 · MEERA (V.O.) 3 · YOUNG MEERA 2`, busiest first. */
export const cueLine = (cues: readonly { readonly cue: string; readonly occurrences: number }[]): readonly string[] =>
  [...cues].sort((a, b) => b.occurrences - a.occurrences || a.cue.localeCompare(b.cue)).map((cue) => `${cue.cue} ${String(cue.occurrences)}`)

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = 'warn' | 'ok' | 'accent'

/** README, "Status as a dot plus a pill": amber draft, green defined, accent locked. */
export const statusTone = (status: CharacterStatus): Tone =>
  status === 'draft' ? 'warn' : status === 'defined' ? 'ok' : 'accent'

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * The sidebar's groups: a threshold, not a column (`0013` dropped the
 * column of that name). A character with at least a fifth of the lead's
 * scenes is a principal, the rest on the page are supporting, and a record
 * with no scene at all - kept by design, AGENTS.md's "0 appearances ·
 * record kept" - is off the page.
 */
export type CastGroup = 'principal' | 'supporting' | 'off-page'

export const CAST_GROUPS: readonly CastGroup[] = ['principal', 'supporting', 'off-page']

export const CAST_GROUP_LABELS: Readonly<Record<CastGroup, string>> = {
  principal: 'Principal',
  supporting: 'Supporting',
  'off-page': 'Off the page',
}

export const PRINCIPAL_SHARE = 0.2

export const groupOf = (appearances: number, lead: number): CastGroup =>
  appearances === 0 ? 'off-page' : appearances >= lead * PRINCIPAL_SHARE ? 'principal' : 'supporting'

/** The lead's scene count: the threshold every group reads against. */
export const leadOf = (rows: readonly { readonly appearances: number }[]): number =>
  rows.reduce((most, row) => Math.max(most, row.appearances), 0)

// ---------------------------------------------------------------------------
// Conflicts: the resolve queue, per record
// ---------------------------------------------------------------------------

/**
 * The one disagreement between a record and the script the model detects:
 * an open cue whose proposal points at a record - `MIRA` reads like
 * `Meera Pawar`. README, "Conflict blocks": the card's border turns
 * `--warn` and an amber block offers to accept the change (bind the
 * spelling) or mark it deliberate (reject that candidate). The script is
 * never edited either way.
 */
export const conflictsOf = (resolve: readonly ResolveItem[]): ReadonlyMap<CharacterId, readonly ResolveItem[]> => {
  const byRecord = new Map<CharacterId, ResolveItem[]>()
  for (const item of resolve) {
    if (item.proposal === null || item.proposal.kind !== 'character') continue
    const list = byRecord.get(item.proposal.id) ?? []
    list.push(item)
    byRecord.set(item.proposal.id, list)
  }
  return byRecord
}

/** `3 names in the script don't match a character` - the banner's line. */
export const unmatchedLabel = (count: number): string =>
  count === 1 ? "1 name in the script doesn't match a character" : `${String(count)} names in the script don't match a character`

// ---------------------------------------------------------------------------
// Presence: one cell per scene of the index
// ---------------------------------------------------------------------------

export type StripState = 'speaks' | 'mentioned' | 'absent'

/** One cell per present scene, index order: speaks, mentioned, or absent. */
export const stripOf = (id: CharacterId, index: readonly SceneFacts[]): readonly StripState[] =>
  index.map((scene) => (scene.speaking.includes(id) ? 'speaks' : scene.mentioned.includes(id) ? 'mentioned' : 'absent'))

export const presenceCounts = (strip: readonly StripState[]): { readonly speaks: number; readonly mentioned: number } => ({
  speaks: strip.filter((state) => state === 'speaks').length,
  mentioned: strip.filter((state) => state === 'mentioned').length,
})

/** A run of absent scenes between two appearances this long or longer is worth a line. */
export const GAP_SCENES = 5

/**
 * The longest run of scenes between two appearances - `longest gap · 11
 * scenes · E2 Sc 3 → E2 Sc 13`. Only between appearances: the scenes
 * before the first or after the last are not a gap in a part, they are
 * its span. Null under the threshold, or with fewer than two appearances.
 */
export const longestGap = (
  strip: readonly StripState[],
  index: readonly SceneFacts[],
): { readonly scenes: number; readonly from: SceneFacts; readonly to: SceneFacts } | null => {
  let best: { scenes: number; from: number; to: number } | null = null
  let last: number | null = null
  strip.forEach((state, at) => {
    if (state === 'absent') return
    if (last !== null) {
      const scenes = at - last - 1
      if (scenes >= GAP_SCENES && (best === null || scenes > best.scenes)) best = { scenes, from: last, to: at }
    }
    last = at
  })
  if (best === null) return null
  const found: { scenes: number; from: number; to: number } = best
  const from = index[found.from]
  const to = index[found.to]
  return from === undefined || to === undefined ? null : { scenes: found.scenes, from, to }
}

/** The strip's cell as `@folio/ui`'s `PresenceStrip` draws it: speaks is `full`, mentioned `half`, absent `none`. */
export type StripCellState = 'full' | 'half' | 'none'

export const cellStateOf = (state: StripState): StripCellState => (state === 'speaks' ? 'full' : state === 'mentioned' ? 'half' : 'none')

export type StripGroup = {
  readonly label: string
  readonly cells: readonly { readonly key: string; readonly state: StripCellState; readonly title: string }[]
}

/** The strip grouped by episode, each cell titled `E2 Sc 9 · INT. CHAWL - NIGHT · speaks`. */
export const stripGroups = (strip: readonly StripState[], index: readonly SceneFacts[]): readonly StripGroup[] => {
  const groups: { label: string; ordinal: number; cells: { key: string; state: StripCellState; title: string }[] }[] = []
  index.forEach((scene, at) => {
    const state = strip[at] ?? 'absent'
    let group = groups.at(-1)
    if (group === undefined || group.ordinal !== scene.episodeOrdinal) {
      group = { label: `E${String(scene.episodeOrdinal)}`, ordinal: scene.episodeOrdinal, cells: [] }
      groups.push(group)
    }
    group.cells.push({
      key: scene.sceneNodeId,
      state: cellStateOf(state),
      title: `E${String(scene.episodeOrdinal)} Sc ${String(scene.number)} · ${scene.heading === '' ? 'No heading yet' : scene.heading} · ${state}`,
    })
  })
  return groups.map(({ label, cells }) => ({ label, cells }))
}

/** How many scenes each strip size can draw before it falls back to the episode bars. */
export const STRIP_LIMIT = { card: 96, drawer: 240, sheet: 80 } as const

export const fitsStrip = (size: keyof typeof STRIP_LIMIT, scenes: number): boolean => scenes <= STRIP_LIMIT[size]

// ---------------------------------------------------------------------------
// Sets and the scenes breakdown
// ---------------------------------------------------------------------------

export type SetRow = {
  readonly id: string
  readonly name: string
  readonly scenes: number
  readonly day: number
  readonly night: number
}

/** The sets a character's scenes are at, most scenes first, with the day/night split. */
export const setsOf = (refs: readonly SceneFacts[]): readonly SetRow[] => {
  const rows = new Map<string, { id: string; name: string; scenes: number; day: number; night: number }>()
  for (const ref of refs) {
    if (ref.set === null) continue
    const row = rows.get(ref.set.id) ?? { id: ref.set.id, name: ref.set.name, scenes: 0, day: 0, night: 0 }
    row.scenes += 1
    if (ref.light === 'day') row.day += 1
    if (ref.light === 'night') row.night += 1
    rows.set(ref.set.id, row)
  }
  return [...rows.values()].sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name))
}

export type EpisodeBreakdown = {
  readonly ordinal: number
  readonly scenes: readonly SceneFacts[]
  /** Eighths summed over the measured scenes; null when none is measured. */
  readonly eighths: number | null
  readonly speaks: number
  readonly mentioned: number
}

/** The drawer's `Scenes` section: the character's scenes grouped by episode with the totals each eyebrow prints. */
export const breakdownOf = (id: CharacterId, refs: readonly SceneFacts[]): readonly EpisodeBreakdown[] => {
  const groups = new Map<number, SceneFacts[]>()
  for (const ref of refs) {
    const list = groups.get(ref.episodeOrdinal) ?? []
    list.push(ref)
    groups.set(ref.episodeOrdinal, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ordinal, scenes]) => {
      const eighths = new Map<NodeId, number>(scenes.flatMap((scene) => (scene.eighths === null ? [] : [[scene.sceneNodeId, scene.eighths]])))
      return {
        ordinal,
        scenes,
        eighths: sumEighths(
          scenes.map((scene) => scene.sceneNodeId),
          eighths,
        ),
        speaks: scenes.filter((scene) => scene.speaking.includes(id)).length,
        mentioned: scenes.filter((scene) => !scene.speaking.includes(id) && scene.mentioned.includes(id)).length,
      }
    })
}

/** How many scenes an episode's group shows before `+ N more scenes`. */
export const SCENES_SHOWN = 8

// ---------------------------------------------------------------------------
// The map: pairs, findings
// ---------------------------------------------------------------------------

export type SharedPair = {
  readonly a: number
  readonly b: number
  readonly shared: number
}

/** Every pair that shares a scene, most shared first, then by column order. */
export const sharedPairs = (map: CharacterMap): readonly SharedPair[] => {
  const pairs: SharedPair[] = []
  map.cells.forEach((row, a) => {
    row.forEach((shared, b) => {
      if (b <= a || shared === 0) return
      pairs.push({ a, b, shared })
    })
  })
  return pairs.sort((x, y) => y.shared - x.shared || x.a - y.a || x.b - y.b)
}

/** The map narrowed to these ids, in the map's order. */
export const mapOf = (map: CharacterMap, ids: ReadonlySet<CharacterId>): CharacterMap => {
  const indexes = map.columns.flatMap((column, index) => (ids.has(column.id) ? [index] : []))
  return {
    columns: indexes.flatMap((index) => {
      const column = map.columns[index]
      return column === undefined ? [] : [column]
    }),
    cells: indexes.map((row) => indexes.map((column) => map.cells[row]?.[column] ?? 0)),
  }
}

/** The scenes two characters are both in, script order. */
export const sharedRefs = <R extends SceneRef>(a: readonly NodeId[], b: readonly NodeId[], refs: ReadonlyMap<NodeId, R>): readonly R[] => {
  const set = new Set<NodeId>(b)
  return refsOf(
    a.filter((id) => set.has(id)),
    refs,
  )
}

/** The first pair of principals with no scene together, by combined scenes; the finding under the grid. */
export const neverShare = (map: CharacterMap, groups: readonly CastGroup[]): readonly [number, number] | null => {
  let best: readonly [number, number] | null = null
  let weight = -1
  map.cells.forEach((row, a) => {
    row.forEach((shared, b) => {
      if (b <= a || shared > 0) return
      if (groups[a] !== 'principal' || groups[b] !== 'principal') return
      const w = (map.columns[a]?.scenes ?? 0) + (map.columns[b]?.scenes ?? 0)
      if (w > weight) {
        weight = w
        best = [a, b]
      }
    })
  })
  return best
}

/**
 * Two principals who share many scenes but rarely speak to each other -
 * `Meera and Anil share 21 scenes but only speak to each other in 4.` The
 * pair with the most shared scenes whose exchanges cover under a quarter
 * of them; null when no pair qualifies or the cast is too small to say.
 */
export const silentPair = (
  map: CharacterMap,
  exchanges: ReadonlyMap<CharacterId, readonly ExchangeRow[]>,
  groups: readonly CastGroup[],
): { readonly a: number; readonly b: number; readonly shared: number; readonly talk: number } | null => {
  let best: { a: number; b: number; shared: number; talk: number } | null = null
  map.cells.forEach((row, a) => {
    row.forEach((shared, b) => {
      if (b <= a || shared < 4) return
      if (groups[a] !== 'principal' || groups[b] !== 'principal') return
      const idA = map.columns[a]?.id
      const idB = map.columns[b]?.id
      if (idA === undefined || idB === undefined) return
      const talk = exchanges.get(idA)?.find((exchange) => exchange.other === idB)?.scenes.length ?? 0
      if (talk * 4 >= shared) return
      if (best === null || shared > best.shared) best = { a, b, shared, talk }
    })
  })
  return best
}

// ---------------------------------------------------------------------------
// Balance: who carries each episode
// ---------------------------------------------------------------------------

/** Dialogue words per episode for one record, from its per-scene counts and the index. */
export const episodeWords = (
  sceneCounts: readonly { readonly scene: NodeId; readonly words: number }[],
  refs: ReadonlyMap<NodeId, SceneRef>,
  episodeOrdinals: readonly number[],
): readonly number[] => {
  const counts = new Map<number, number>(episodeOrdinals.map((ordinal) => [ordinal, 0]))
  for (const count of sceneCounts) {
    const ref = refs.get(count.scene)
    if (ref === undefined) continue
    counts.set(ref.episodeOrdinal, (counts.get(ref.episodeOrdinal) ?? 0) + count.words)
  }
  return episodeOrdinals.map((ordinal) => counts.get(ordinal) ?? 0)
}

/** Every dialogue word under each episode's headings, resolved or not. */
export const episodeTotals = (index: readonly SceneFacts[], episodeOrdinals: readonly number[]): readonly number[] =>
  episodeOrdinals.map((ordinal) => index.filter((scene) => scene.episodeOrdinal === ordinal).reduce((total, scene) => total + scene.words, 0))

export type BalanceRow = {
  readonly ordinal: number
  readonly total: number
  readonly voices: number
  readonly lead: { readonly id: CharacterId; readonly name: string; readonly words: number; readonly share: number } | null
}

/** The sheet's `Balance` card: per episode, who speaks most and how much of the dialogue that is. */
export const balanceOf = (
  figures: readonly { readonly id: CharacterId; readonly name: string; readonly episodeWords: readonly number[] }[],
  index: readonly SceneFacts[],
  episodeOrdinals: readonly number[],
): readonly BalanceRow[] => {
  const totals = episodeTotals(index, episodeOrdinals)
  return episodeOrdinals.map((ordinal, at) => {
    const total = totals[at] ?? 0
    const voices = figures.filter((figure) => (figure.episodeWords[at] ?? 0) > 0)
    const lead = voices.reduce<(typeof voices)[number] | null>(
      (best, figure) => (best === null || (figure.episodeWords[at] ?? 0) > (best.episodeWords[at] ?? 0) ? figure : best),
      null,
    )
    return {
      ordinal,
      total,
      voices: voices.length,
      lead:
        lead === null
          ? null
          : { id: lead.id, name: lead.name, words: lead.episodeWords[at] ?? 0, share: shareOf(lead.episodeWords[at] ?? 0, total) },
    }
  })
}

/**
 * The timing finding: the character speaks in a scene before the action
 * introduces them. `E1 Sc 2` when the first line's scene comes before the
 * introduction's in script order; null when introduced first, never
 * introduced, or the finding was waved through.
 */
export const introBeforeSpeech = (
  figure: Pick<CastRow, 'firstLine' | 'introducedAt' | 'intro'>,
  refs: ReadonlyMap<NodeId, SceneRef>,
): SceneRef | null => {
  if (figure.firstLine === null || figure.introducedAt === null || figure.intro === null || figure.intro.deliberate) return null
  if (figure.firstLine.sceneNodeId === null || figure.introducedAt.sceneNodeId === null) return null
  const spoke = refs.get(figure.firstLine.sceneNodeId)
  const introduced = refs.get(figure.introducedAt.sceneNodeId)
  if (spoke === undefined || introduced === undefined) return null
  const before = spoke.episodeOrdinal < introduced.episodeOrdinal || (spoke.episodeOrdinal === introduced.episodeOrdinal && spoke.number < introduced.number)
  return before ? spoke : null
}

// ---------------------------------------------------------------------------
// The card, assembled
// ---------------------------------------------------------------------------

/** Everything a card, a row, a strip and the drawer print about one record - `CastRow` plus the derived fields. */
export type CastFigure = CastRow & {
  readonly initial: string
  readonly group: CastGroup
  readonly perEpisode: readonly number[]
  readonly episodeWords: readonly number[]
  readonly share: number
  readonly first: SceneFacts | null
  readonly last: SceneFacts | null
  /** The character's scenes as facts, script order. */
  readonly refs: readonly SceneFacts[]
  readonly conflicts: readonly ResolveItem[]
  readonly speaks: number
  readonly mentionedIn: number
  readonly strip: readonly StripState[]
  readonly gap: ReturnType<typeof longestGap>
  readonly sets: readonly SetRow[]
  /** The scene the character first speaks in before the action introduces them, or null. */
  readonly introConflict: SceneRef | null
}

/** The chip's letters: `M`, or the second word's initial past a leading article. */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter((word) => word !== '')
  const first = words[0]?.[0]
  if (first === undefined) return '·'
  if (words.length >= 2 && /^(the|a|an)$/i.test(words[0] ?? '')) return (words[1]?.[0] ?? first).toUpperCase()
  return first.toUpperCase()
}

export const figuresOf = (
  cast: readonly CastRow[],
  index: readonly SceneFacts[],
  episodeOrdinals: readonly number[],
  resolve: readonly ResolveItem[],
): readonly CastFigure[] => {
  const refs = new Map<NodeId, SceneFacts>(index.map((ref) => [ref.sceneNodeId, ref]))
  const lead = leadOf(cast)
  const conflicts = conflictsOf(resolve)
  const projectWords = index.reduce((total, scene) => total + scene.words, 0)
  return cast.map((row) => {
    const ends = firstLast(row.scenes, refs)
    const ordered = refsOf(row.scenes, refs)
    const strip = stripOf(row.id, index)
    const counts = presenceCounts(strip)
    return {
      ...row,
      initial: initialsOf(row.name),
      group: groupOf(row.appearances, lead),
      perEpisode: perEpisode(row.scenes, refs, episodeOrdinals),
      episodeWords: episodeWords(row.sceneCounts, refs, episodeOrdinals),
      share: shareOf(row.words, projectWords),
      first: ends?.first ?? null,
      last: ends?.last ?? null,
      refs: ordered,
      conflicts: conflicts.get(row.id) ?? [],
      speaks: counts.speaks,
      mentionedIn: counts.mentioned,
      strip,
      gap: longestGap(strip, index),
      sets: setsOf(ordered),
      introConflict: introBeforeSpeech(row, refs),
    }
  })
}

/** The sidebar widget's two rows, from the figures and the queue. */
export const castWidgetOf = (
  rows: readonly { readonly presence: Presence }[],
  decisions: number,
): { readonly decisions: number; readonly present: number; readonly total: number } => ({ decisions, ...onPageOf(rows) })
