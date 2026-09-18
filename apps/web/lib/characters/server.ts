import type {
  AliasProvenance,
  CastRow,
  CharacterFinding,
  CharacterMap,
  CharacterProfile,
  CueVariantRow,
  IntroLine,
  MapColumn,
  PairItem,
  QuotedLine,
  ResolveCandidate,
  ResolveItem,
  ResolveProposal,
  SceneFacts,
  SceneRef,
  TalksToRow,
} from '@folio/contracts'
import { hueOfColor } from '@folio/contracts'
import {
  listBoundCues,
  listCharacterFindings,
  listCharacterRecords,
  listCueTallies,
  listLocationRecords,
  listOpenCueRows,
  listResolveDecisions,
  listSceneEighths,
  listSceneIndex,
  readMentionLabels,
  readMergedInto,
  readScreenplayNodesById,
} from '@folio/db'
import type { BoundCueRow, CharacterFindingRow, CharacterRecordRow, CueTallyRow } from '@folio/db'
import type { CharacterId, CharacterNamePool, MentionLabel, NodeId, ProposalTarget, ResolveSubject, ScreenplayNode } from '@folio/script'
import { ageOnThePage, canonicalKey, matchCharacterNames, readCue, similarRecords } from '@folio/script'
import { cache } from 'react'

import { deriveSpeculatively, readDerivationReads } from '../script/server'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'
import { sharedScenes } from './figures'
import { buildMap, sceneFactsOf, sceneRefOf } from './figures'

/**
 * Everything the Characters route reads, and where each part comes from.
 *
 * Like the Scenes loader this is a *join*, never a computation over the
 * script: every count comes from the table that owns it -
 *
 *   `cast[]`      `characters` ⋈ `character_derivations` ⋈ `character_cue_tallies`
 *                 (`listCharacterRecords`, `listCueTallies`) - the record, the
 *                 voice the pass counted, its counted spellings
 *   `index[]`     `scene_derivations` ⋈ episodes, joined to the location records
 *                 for set names and the last measurement for eighths
 *                 (`listSceneIndex`, `listLocationRecords`, `listSceneEighths`)
 *   `resolve[]`   `resolve_rows` open, kind cue, with a proposal (`listOpenCueRows`) -
 *                 the queue's rows and the badge's count; each ranked against the
 *                 cast (`matchCharacterNames` over `character_bound_cues`) for the
 *                 reason it prints and the `Someone else…` menu
 *   `walkOns[]`   the open cue rows with no proposal - the writer said "not a
 *                 character"; listed under the queue so the decision can be taken back
 *   `pairs[]`     two records that read as one person (`similarRecords`), minus the
 *                 pairs the writer said are different (`record:` decision rows)
 *   `map`         the derived `scenes` arrays, intersected  (`buildMap`)
 *   quotes        the first line and the introduction of every record, read by node
 *                 id (`readScreenplayNodesById`) - the one read of the script itself
 *   a profile     the above plus `character_bound_cues`, the last and longest line,
 *                 who they talk to, and the findings
 *
 * The one place a derivation is *run* is the empty state: with no record at
 * all, the card says how many cues the script holds, and that is a
 * speculative pass over the same reads the Script route's stats use - ids
 * discarded, nothing written.
 *
 * `cache()`d per request, keyed by the project context, so the page and the
 * layout share one read.
 */

/** How many ranked records the queue's `Someone else…` menu lists first, before the rest of the cast. */
const CANDIDATES_SHOWN = 3

/** Grid order: most scenes first, then lines, then the name. A record kept at zero sits last. */
const byGrid = (a: CastRow, b: CastRow): number =>
  b.appearances - a.appearances || b.lines - a.lines || a.name.localeCompare(b.name)

const cueRowOf = (tally: CueTallyRow): CueVariantRow => ({
  cue: tally.cue,
  key: tally.key,
  occurrences: tally.occurrences,
  lines: tally.lines,
  words: tally.words,
})

/** The counted spellings per record, insertion order. */
export const cuesByRecord = (tallies: readonly CueTallyRow[]): ReadonlyMap<CharacterId, readonly CueVariantRow[]> => {
  const out = new Map<CharacterId, CueVariantRow[]>()
  for (const tally of tallies) {
    const list = out.get(tally.characterId) ?? []
    list.push(cueRowOf(tally))
    out.set(tally.characterId, list)
  }
  return out
}

const at = (line: { readonly nodeId: NodeId; readonly scene: NodeId | null } | null) =>
  line === null ? null : { nodeId: line.nodeId, sceneNodeId: line.scene }

const longestOf = (line: { readonly nodeId: NodeId; readonly scene: NodeId | null; readonly words: number } | null) =>
  line === null ? null : { nodeId: line.nodeId, sceneNodeId: line.scene, words: line.words }

/** A character record as the grid draws it. Shared with the Production loader, which reads the same cast. */
export const castRowOf = (record: CharacterRecordRow, cues: readonly CueVariantRow[]): CastRow => ({
  id: record.id,
  name: record.name,
  color: record.color,
  hue: hueOfColor(record.color),
  gender: record.gender,
  age: record.age,
  role: record.role,
  bio: record.bio,
  appearance: record.appearance,
  status: record.status,
  wants: record.wants,
  needs: record.needs,
  portraitUrl: publicUrl(record.portraitKey),
  origin: record.origin,
  presence: record.derived?.presence ?? 'absent',
  appearances: record.derived?.appearances ?? 0,
  lines: record.derived?.lines ?? 0,
  mentions: record.derived?.mentions ?? 0,
  scenes: record.derived?.scenes ?? [],
  cues,
  words: record.derived?.words ?? 0,
  speeches: record.derived?.speeches ?? 0,
  parens: record.derived?.parens ?? 0,
  namedIn: record.derived?.namedIn ?? 0,
  firstLine: at(record.derived?.firstLine ?? null),
  lastLine: at(record.derived?.lastLine ?? null),
  longest: longestOf(record.derived?.longest ?? null),
  introducedAt: at(record.derived?.introducedAt ?? null),
  sceneCounts: record.derived?.sceneCounts ?? [],
  exchanges: record.derived?.exchanges ?? [],
  quote: null,
  intro: null,
})

/** Who bound a spelling, as the alias row prints it. */
const provenanceOf = (entry: BoundCueRow, actor: string | null): AliasProvenance =>
  entry.boundBy === null ? 'derived' : entry.boundBy === actor ? 'you' : 'member'

export const isCueSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'cue' }> =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  value.kind === 'cue' &&
  'cue' in value &&
  typeof value.cue === 'string'

const isTarget = (value: unknown): value is ProposalTarget =>
  typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

// ---------------------------------------------------------------------------
// Quoting the page
// ---------------------------------------------------------------------------

/** A node's text as the page reads it: a mention by its record's label. */
export const nodeText = (node: ScreenplayNode, labels: readonly MentionLabel[]): string =>
  node.content
    .map((run) =>
      run.kind === 'text' ? run.text : (labels.find((label) => label.entity === run.target.entity && label.id === run.target.id)?.label ?? '?'),
    )
    .join('')
    .trim()

/** The intro decision key: `intro:<record>:<node>` - a plain-text key in `resolve_decisions`, never a queue row's. */
export const introDecisionKey = (id: CharacterId, nodeId: NodeId): string => `intro:${id}:${nodeId}`

/** The pair decision key: `record:<a>:<b>` with the ids sorted, so either order finds the row. */
export const pairDecisionKey = (a: CharacterId, b: CharacterId): string => (a < b ? `record:${a}:${b}` : `record:${b}:${a}`)

const quoteOf = (
  line: { readonly nodeId: NodeId; readonly sceneNodeId: NodeId | null } | null,
  texts: ReadonlyMap<NodeId, ScreenplayNode>,
  labels: readonly MentionLabel[],
): QuotedLine | null => {
  if (line === null) return null
  const node = texts.get(line.nodeId)
  if (node === undefined) return null
  const text = nodeText(node, labels)
  return text === '' ? null : { nodeId: line.nodeId, text, sceneNodeId: line.sceneNodeId }
}

/** The row with its first line and introduction quoted from the nodes read. */
const withTexts = (
  row: CastRow,
  keys: readonly string[],
  texts: ReadonlyMap<NodeId, ScreenplayNode>,
  labels: readonly MentionLabel[],
  deliberate: ReadonlySet<string>,
): CastRow => {
  const quote = quoteOf(row.firstLine, texts, labels)
  const introduction = quoteOf(row.introducedAt, texts, labels)
  const intro: IntroLine | null =
    introduction === null
      ? null
      : {
          ...introduction,
          age: ageOnThePage(introduction.text, keys),
          deliberate: deliberate.has(introDecisionKey(row.id, introduction.nodeId)),
        }
  return { ...row, quote, intro }
}

// ---------------------------------------------------------------------------
// The load
// ---------------------------------------------------------------------------

export type CharactersLoad = {
  readonly records: readonly CharacterRecordRow[]
  /** Grid order. */
  readonly cast: readonly CastRow[]
  /** Open cue rows with a proposal - the queue's rows, and the badge's count. */
  readonly resolve: readonly ResolveItem[]
  /** Open cue rows with no proposal - the walk-ons, `proposal` null, listed under the queue. */
  readonly walkOns: readonly ResolveItem[]
  /** Two records that read as one person, minus the pairs the writer said are different. */
  readonly pairs: readonly PairItem[]
  readonly map: CharacterMap
  /** Distinct counted spellings across every record - the footer's `N cues`. */
  readonly cueCount: number
  /** Every present scene as facts - what the strips, the breakdown, the sets and the Presence view read. */
  readonly index: readonly SceneFacts[]
  /** Every record's name and bound spellings, keyed by id - what the profile's sides and the assistant's Focus read. */
  readonly labels: readonly MentionLabel[]
  /** Only with no record at all: what a pass would derive - the count, and the three busiest cues. */
  readonly derivable: Derivable | null
  /** Whether the five `R2_*` variables are set - whether Upload can be offered. */
  readonly storage: boolean
}

export type Derivable = {
  readonly count: number
  /** `MEERA · 79 scenes`, busiest first, at most three - the empty card's mono block. */
  readonly top: readonly { readonly cue: string; readonly scenes: number }[]
}

export const loadCharacters = cache(async (context: ProjectContext): Promise<CharactersLoad> => {
  const { scope, project } = context
  const [records, sceneRows, cueRows, tallies, bound, decisions, eighths, locationRecords, labels] = await Promise.all([
    listCharacterRecords(scope),
    listSceneIndex(scope),
    listOpenCueRows(scope),
    listCueTallies(scope),
    listBoundCues(scope),
    listResolveDecisions(scope),
    listSceneEighths(scope, project.format),
    listLocationRecords(scope),
    readMentionLabels(scope),
  ])
  const sets = new Map(locationRecords.map((record) => [record.id, record.name]))
  const index = sceneRows.map((row) => sceneFactsOf(row, eighths, sets))
  const refByScene = new Map<NodeId, SceneRef>(sceneRows.map((row) => [row.sceneNodeId, sceneRefOf(row)]))
  const cues = cuesByRecord(tallies)

  // The pool the queue ranks against: every live record, its name and its
  // bound spellings - the same scoring a pass uses, so the candidates are
  // exactly what later passes would propose one at a time.
  const boundById = new Map<CharacterId, string[]>()
  for (const entry of bound) {
    const list = boundById.get(entry.characterId)
    if (list === undefined) boundById.set(entry.characterId, [entry.cue])
    else list.push(entry.cue)
  }
  const pool: CharacterNamePool[] = records.map((record) => ({
    id: record.id,
    name: record.name,
    boundCues: boundById.get(record.id) ?? [],
  }))

  // The page, quoted: the first line and the introduction of every record,
  // in one read by node id. A node that has left the script quotes nothing.
  const wanted = records.flatMap((record) =>
    [record.derived?.firstLine?.nodeId, record.derived?.introducedAt?.nodeId].flatMap((id) => (id === undefined ? [] : [id])),
  )
  const texts = await readScreenplayNodesById(scope, wanted)
  const deliberate = new Set(decisions.filter((decision) => decision.rowKey.startsWith('intro:') && decision.verdict === 'accepted').map((decision) => decision.rowKey))
  const keysOf = (record: CharacterRecordRow): readonly string[] =>
    [...new Set([canonicalKey(record.name), ...(boundById.get(record.id) ?? []).map((cue) => canonicalKey(readCue(cue).name))])].filter((key) => key !== '')

  const cast = records
    .map((record) => withTexts(castRowOf(record, cues.get(record.id) ?? []), keysOf(record), texts, labels, deliberate))
    .sort(byGrid)
  const castById = new Map(cast.map((row) => [row.id, row]))

  const candidatesFor = (cue: string): readonly ResolveCandidate[] =>
    matchCharacterNames(cue, pool)
      .slice(0, CANDIDATES_SHOWN)
      .flatMap((match) => {
        const record = castById.get(match.id)
        return record === undefined
          ? []
          : [{ id: record.id, name: record.name, hue: record.hue, confidence: match.confidence, reason: match.reason }]
      })

  const resolve: ResolveItem[] = []
  const walkOns: ResolveItem[] = []
  for (const row of cueRows) {
    if (!isCueSubject(row.subject)) continue
    const candidates = candidatesFor(row.subject.cue)
    const scenes = row.scenes.flatMap((id) => {
      const ref = refByScene.get(id)
      return ref === undefined ? [] : [ref]
    })
    const item = { key: row.key, cue: row.subject.cue, occurrences: row.occurrences, scenes, candidates }
    if (row.proposalTarget === null || row.proposalConfidence === null) {
      walkOns.push({ ...item, proposal: null })
      continue
    }
    const target = row.proposalTarget
    let proposal: ResolveProposal | null = null
    if (isTarget(target)) {
      if (target.kind === 'character') {
        const record = castById.get(target.id)
        proposal =
          record === undefined
            ? null
            : {
                kind: 'character',
                id: record.id,
                name: record.name,
                hue: record.hue,
                confidence: row.proposalConfidence,
                reason: candidates.find((candidate) => candidate.id === record.id)?.reason ?? null,
              }
      } else if (target.kind === 'new-record') {
        proposal = { kind: 'new-record', confidence: row.proposalConfidence }
      }
    }
    if (proposal === null) continue
    resolve.push({ ...item, proposal })
  }

  // Two records that read as one person - the queue's pair rows - minus
  // the pairs the writer said are different. `keep` is the busier record.
  const rejectedPairs = new Set(
    decisions.filter((decision) => decision.rowKey.startsWith('record:') && decision.verdict === 'rejected').map((decision) => decision.rowKey),
  )
  const pairs: PairItem[] = similarRecords(pool).flatMap((pair) => {
    const key = pairDecisionKey(pair.a, pair.b)
    if (rejectedPairs.has(key)) return []
    const a = castById.get(pair.a)
    const b = castById.get(pair.b)
    if (a === undefined || b === undefined) return []
    const side = (row: CastRow) => ({ id: row.id, name: row.name, hue: row.hue, appearances: row.appearances })
    const [keep, other] = b.appearances > a.appearances ? [b, a] : [a, b]
    return [{ key, keep: side(keep), other: side(other), confidence: pair.confidence }]
  })

  const columns: MapColumn[] = cast
    .filter((row) => row.presence === 'present')
    .map((row) => ({ id: row.id, name: row.name, hue: row.hue, lines: row.lines, scenes: row.appearances }))
  const scenesOf = new Map<CharacterId, readonly NodeId[]>(cast.map((row) => [row.id, row.scenes]))

  const derivable = records.length === 0 ? await countDerivable(context) : null

  return {
    records,
    cast,
    resolve,
    walkOns,
    pairs,
    map: buildMap(columns, scenesOf),
    cueCount: new Set(tallies.map((tally) => tally.cue)).size,
    index,
    labels,
    derivable,
    storage: storageAvailable(),
  }
})

/** With no record yet: what a derivation pass over the script would mint - the count and the busiest cues. */
const countDerivable = async (context: ProjectContext): Promise<Derivable> => {
  const reads = await readDerivationReads(context.scope)
  const pass = deriveSpeculatively(reads)
  if (pass === null) return { count: 0, top: [] }
  const present = pass.entities.characters.filter((record) => record.presence === 'present')
  const top = [...present]
    .sort((a, b) => b.appearances - a.appearances || b.lines - a.lines)
    .slice(0, 3)
    .flatMap((record) => {
      const cue = record.cues[0]?.cue ?? record.authored.name
      return [{ cue, scenes: record.appearances }]
    })
  return { count: present.length, top }
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

export type ProfileLoad =
  | { readonly state: 'profile'; readonly profile: CharacterProfile }
  | { readonly state: 'merged'; readonly into: CharacterId }
  | { readonly state: 'missing' }

/** A finding row as the drawer draws it: both scenes as refs. Null when either scene has left the index. */
export const findingOf = (row: CharacterFindingRow, refByScene: ReadonlyMap<NodeId, SceneRef>): CharacterFinding | null => {
  const a = refByScene.get(row.aRef)
  const b = refByScene.get(row.bRef)
  if (a === undefined || b === undefined) return null
  return {
    id: row.id,
    characterId: row.characterId,
    kind: 'contradiction',
    status: row.status,
    claim: row.claim,
    a: { ref: a, quote: row.aQuote },
    b: { ref: b, quote: row.bQuote },
    createdAt: row.createdAt,
  }
}

/** One record for the drawer: its card plus the alias table, the voice, who they talk to and the findings. */
export const loadProfile = cache(
  async (context: ProjectContext, characterId: CharacterId): Promise<ProfileLoad> => {
    const { scope } = context
    const load = await loadCharacters(context)
    const record = load.records.find((entry) => entry.id === characterId)
    if (record === undefined) {
      const into = await readMergedInto(scope, characterId)
      return into === null ? { state: 'missing' } : { state: 'merged', into }
    }
    const row = load.cast.find((entry) => entry.id === characterId)
    if (row === undefined) return { state: 'missing' }

    const wanted = [row.lastLine?.nodeId, row.longest?.nodeId].flatMap((id) => (id === undefined ? [] : [id]))
    const [bound, findingRows, texts] = await Promise.all([
      listBoundCues(scope),
      listCharacterFindings(scope, characterId),
      readScreenplayNodesById(scope, wanted),
    ])
    const myBound = bound.filter((entry) => entry.characterId === characterId)
    const nameKey = canonicalKey(record.name)
    const refByScene = new Map<NodeId, SceneRef>(load.index.map((scene) => [scene.sceneNodeId, scene]))
    const longest = quoteOf(row.longest, texts, load.labels)

    const talksTo: TalksToRow[] = row.exchanges.flatMap((exchange) => {
      const other = load.cast.find((entry) => entry.id === exchange.other)
      return other === undefined
        ? []
        : [
            {
              id: other.id,
              name: other.name,
              hue: other.hue,
              count: exchange.count,
              scenes: exchange.scenes,
              shared: sharedScenes(row.scenes, other.scenes),
            },
          ]
    })

    return {
      state: 'profile',
      profile: {
        ...row,
        boundCues: myBound.map((entry) => entry.cue),
        bound: myBound.map((entry) => ({ cue: entry.cue, provenance: provenanceOf(entry, scope.actor) })),
        nameCues: row.cues.filter((tally) => tally.key === nameKey).reduce((total, tally) => total + tally.occurrences, 0),
        voice: {
          first: row.quote,
          last: quoteOf(row.lastLine, texts, load.labels),
          longest: longest === null || row.longest === null ? null : { ...longest, words: row.longest.words },
        },
        talksTo,
        findings: findingRows.flatMap((finding) => {
          const view = findingOf(finding, refByScene)
          return view === null ? [] : [view]
        }),
      },
    }
  },
)

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterCharacters = async (
  rawProjectId: string,
): Promise<{ readonly context: ProjectContext; readonly load: CharactersLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadCharacters(context) }
}
