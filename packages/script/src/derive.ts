import { canonicalKey, compare, confidenceRank } from './alias'
import type {
  CharacterAuthored,
  CharacterRecord,
  Confidence,
  DerivedEntities,
  LocationAuthored,
  LocationCounts,
  LocationRecord,
  Presence,
  Proposal,
  ProposalDecision,
  ProposalTarget,
  ResolveRow,
  ResolveRowState,
  ResolveSubject,
  SceneAuthored,
  SceneRecord,
  SluglineReading,
} from './entities'
import { NO_COUNTS, resolveRowKey } from './entities'
import { readCue, writeCue } from './generated-text'
import type { CharacterId, LocationId, NodeId } from './ids'
import { characterId, locationId } from './ids'
import type { InlineContent, MentionTarget } from './inline'
import type { DeliveryModifier, ScreenplayNode } from './node'
import type { Result } from './result'
import { err, ok } from './result'
import type { SluglineRejection } from './slugline'
import { readSlugline } from './slugline'

/**
 * Derivation. One function, one implementation, no second path.
 *
 * AGENTS.md, Derivation: "Derivation is a **pure function over a node list**. It
 * runs against a saved snapshot in normal operation and against a
 * **speculative** node list to compute blast radius. Same function."
 *
 * There is no fast path, no incremental variant and no speculation mode, and the
 * reason is not tidiness. A speculative derive is only meaningful if it produces
 * *the same answer* the real one would; the moment a second implementation
 * exists, blast radius is a prediction made by code that is not the code that
 * will run, and it will be wrong in exactly the cases anyone cares about. If
 * this ever needs to be faster, it gets faster here, for both callers at once.
 *
 * ## Reconcile, never rebuild
 *
 * `previous` is the last derived set and it is **input**. Every record that was
 * there is still there afterwards - carrying its `authored` sub-object by
 * reference, unexamined and unrebuilt - with only its derived tallies refreshed.
 * Records whose name has left the script do not disappear; they come back with
 * `presence: 'absent'` and zeroed counts, which is AGENTS.md's
 * "`0 appearances · record kept`" modelled rather than implied.
 *
 * Where that bit, and it bit repeatedly, is written up at the bottom of this
 * header.
 *
 * ## The two rulings this file is built on
 *
 * 1. **Ids come from the caller.** This package has no entropy (AGENTS.md,
 *    Development philosophy 2), so `options.freshIds` is consumed in document
 *    order, exactly as `parseFountain` and `importFinalDraft` already do, and a
 *    short list is `{ kind: 'not-enough-ids' }` data rather than a throw.
 *    `countDerivationIds` answers "how many" before any is spent, the same way
 *    `countFdxNodes` does. The consequence worth naming: with the same nodes,
 *    the same `previous` and the same id list, this function is byte-identical
 *    twice - which is the property that makes the speculative call legitimate.
 *
 * 2. **The location tree is authored; derivation only proposes.** AGENTS.md says
 *    both that locations are derived from headings and that sub-sets hang off a
 *    primary set. Those describe different things, and the ruling was that the
 *    *records* come from the headings while the *edges* are drawn by a human.
 *    So nothing here ever writes `LocationAuthored.parent`. A slugline that
 *    reads like a sub-set produces a **resolve-queue row** proposing the edge,
 *    with a confidence, which the writer accepts or rejects. Parsing
 *    `INT. KAMATHI CHAWL - CORRIDOR - NIGHT` into a parent and a child is a
 *    guess, and the difference between a guess and a fact is the entire subject
 *    of this module.
 *
 * ## What resolves to what
 *
 * A cue never binds by resemblance. Only an **exact key match against an
 * authored bound cue** resolves (AGENTS.md, Entity identity: matching goes
 * through the alias table). Anything short of that is a proposal in the queue.
 * A record is minted only when a cue resembles *nothing that already exists* -
 * the case where there is no one to confuse it with - or when the writer has
 * accepted a `new-record` proposal. That is what keeps `मीरा` from silently
 * becoming a second Meera: it resembles nothing, so it gets its own record and
 * its own row, and the alias table entry that makes the two one person is the
 * writer's, which is precisely what AGENTS.md says it must be.
 *
 * `@mentions` go through the same records and the same tallies - a mention
 * carries a record id already (see `inline.ts`), so it resolves by edge rather
 * than by text, and a character who is discussed but never speaks is `present`
 * with `lines: 0`. Not a parallel table: the same `scenes` list, the same
 * `appearances`.
 *
 * ## Where reconcile-not-rebuild made this awkward, deliberately
 *
 *   - **Minting has to look at records minted earlier in the same pass.** The
 *     obvious loop resolves every cue against `previous` alone, and then
 *     `MEERA` and `MEERA PAWAR` in a fresh script both mint, and on the next
 *     pass both are exactly bound so no proposal is ever made and they are two
 *     people for good. So the candidate pool grows as the pass runs. The cost is
 *     that which of two mutually-similar unbound cues becomes the record and
 *     which becomes the queue row depends on document order. Deterministic, but
 *     order-sensitive, and worth knowing.
 *   - **Absent records stay in the output forever**, including absent scenes,
 *     and the list only grows. That is the rule working: the alternative loses a
 *     synopsis when a heading is briefly deleted.
 *   - **Queue rows outlive their subjects** (`state: 'gone'`) for the same
 *     reason - a row carries the writer's rejections, and a rejection that
 *     evaporates when a cue is deleted for ten minutes is a rejection the writer
 *     is asked for twice.
 *   - **Comment nodes contribute nothing.** A note reading "check MEERA's age"
 *     is the writer talking about the script, not the script. AGENTS.md says
 *     comments never reach an export and occupy no page space; letting one add
 *     an appearance would make a note authoritative over the story.
 */

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export type DeriveOptions = {
  /**
   * One per record minted, consumed in order. Opaque to this package: the id
   * format is codified where ids are minted (`docs/adr/0001-node-identity.md`),
   * which is not here.
   */
  readonly freshIds: readonly string[]
}

export type MintedRecord =
  | { readonly kind: 'character'; readonly id: CharacterId; readonly from: string }
  | { readonly kind: 'location'; readonly id: LocationId; readonly from: string }

export type DeriveError =
  /** `needed` is exact. Call again with that many and it will succeed. */
  | { readonly kind: 'not-enough-ids'; readonly needed: number; readonly supplied: number }
  | { readonly kind: 'empty-id'; readonly index: number }
  | { readonly kind: 'duplicate-id'; readonly id: string }
  /** A fresh id that an existing record already uses. Ids are never reused. */
  | { readonly kind: 'id-already-in-use'; readonly id: string }
  | { readonly kind: 'duplicate-record-id'; readonly id: string }

/** A Scene node whose text is not a heading. It is reported, never a scene. */
export type RejectedSceneHeading = {
  readonly node: NodeId
  readonly rejection: SluglineRejection
}

/** An `@mention` pointing at a record that does not exist. Reported, not invented. */
export type DanglingMention = {
  readonly node: NodeId
  readonly target: MentionTarget
}

/** An authored `parent` that cannot be honoured. The record rolls up as a root. */
export type BrokenLocationEdge = {
  readonly location: LocationId
  readonly parent: LocationId
  readonly reason: 'unknown-parent' | 'cycle'
}

/** Two records claim one cue or slugline. The first in record order wins. */
export type AmbiguousBinding = {
  readonly kind: 'cue' | 'slugline'
  readonly key: string
  readonly records: readonly string[]
}

export type Derivation = {
  readonly entities: DerivedEntities
  /** Which fresh ids were spent, on what. A speculative caller discards these. */
  readonly minted: readonly MintedRecord[]
  readonly unusedIds: readonly string[]
  readonly rejectedHeadings: readonly RejectedSceneHeading[]
  readonly danglingMentions: readonly DanglingMention[]
  readonly brokenEdges: readonly BrokenLocationEdge[]
  readonly ambiguousBindings: readonly AmbiguousBinding[]
}

// ---------------------------------------------------------------------------
// Reading the node list
// ---------------------------------------------------------------------------

const plainText = (content: InlineContent): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : ''))
    .join('')
    .trim()

const mergeModifiers = (
  authored: readonly DeliveryModifier[],
  fromText: readonly DeliveryModifier[],
): readonly DeliveryModifier[] => {
  const out: DeliveryModifier[] = [...authored]
  for (const modifier of fromText) if (!out.includes(modifier)) out.push(modifier)
  return out
}

type CueVariant = {
  readonly cue: string
  readonly modifiers: readonly DeliveryModifier[]
  occurrences: number
  lines: number
}

type CueAggregate = {
  readonly key: string
  /** The cue with modifiers off, as first authored. What the queue row shows. */
  readonly name: string
  readonly variants: Map<string, CueVariant>
  occurrences: number
  lines: number
  readonly scenes: NodeId[]
}

type SluglineAggregate = {
  readonly key: string
  /** The set text as first authored. */
  readonly set: string
  readonly variants: Map<string, { text: string; occurrences: number }>
  occurrences: number
  readonly scenes: NodeId[]
  dayScenes: number
  nightScenes: number
}

type SceneScan = {
  readonly node: NodeId
  readonly heading: string
  readonly reading: SluglineReading
  readonly sluglineKey: string
  readonly cueKeys: string[]
  readonly mentions: CharacterId[]
  lines: number
}

type Scan = {
  readonly scenes: SceneScan[]
  readonly cues: Map<string, CueAggregate>
  readonly sluglines: Map<string, SluglineAggregate>
  readonly rejectedHeadings: RejectedSceneHeading[]
  readonly mentionedCharacters: Map<CharacterId, { count: number; nodes: NodeId[] }>
  readonly mentionedLocations: Map<LocationId, number>
  readonly mentionNodes: { node: NodeId; target: MentionTarget }[]
}

const pushUnique = <T>(list: T[], value: T): void => {
  if (!list.includes(value)) list.push(value)
}

/**
 * One walk over the node list.
 *
 * Cues are read with `readCue` before anything else touches them, so a cue that
 * still carries `(V.O.)` in its text - typed straight into the editor rather
 * than imported - resolves to the same person as the same cue with the modifier
 * on the node. AGENTS.md, Entity identity: "**Delivery modifiers are parsed off
 * before lookup** and never create a second person."
 */
const scanNodes = (nodes: readonly ScreenplayNode[]): Scan => {
  const scan: Scan = {
    scenes: [],
    cues: new Map<string, CueAggregate>(),
    sluglines: new Map<string, SluglineAggregate>(),
    rejectedHeadings: [],
    mentionedCharacters: new Map<CharacterId, { count: number; nodes: NodeId[] }>(),
    mentionedLocations: new Map<LocationId, number>(),
    mentionNodes: [],
  }

  let scene: SceneScan | undefined
  let cue: { aggregate: CueAggregate; variant: CueVariant } | undefined

  const noteMentions = (node: ScreenplayNode): void => {
    for (const run of node.content) {
      if (run.kind !== 'mention') continue
      scan.mentionNodes.push({ node: node.id, target: run.target })
      if (run.target.entity === 'character') {
        const seen = scan.mentionedCharacters.get(run.target.id) ?? { count: 0, nodes: [] }
        seen.count += 1
        seen.nodes.push(node.id)
        scan.mentionedCharacters.set(run.target.id, seen)
        if (scene !== undefined) pushUnique(scene.mentions, run.target.id)
      } else {
        scan.mentionedLocations.set(
          run.target.id,
          (scan.mentionedLocations.get(run.target.id) ?? 0) + 1,
        )
      }
    }
  }

  for (const node of nodes) {
    // A note is not the script. See the header.
    if (node.type === 'comment') continue

    if (node.type === 'scene') {
      const heading = plainText(node.content)
      const reading = readSlugline(heading)
      if (!reading.ok) {
        // Not a scene, and not the end of the previous one either: the nodes
        // after a demoted heading go on belonging to the scene they were in.
        scan.rejectedHeadings.push({ node: node.id, rejection: reading.error })
        noteMentions(node)
        continue
      }
      const key = canonicalKey(reading.value.set)
      scene = {
        node: node.id,
        heading,
        reading: reading.value,
        sluglineKey: key,
        cueKeys: [],
        mentions: [],
        lines: 0,
      }
      cue = undefined
      scan.scenes.push(scene)

      const aggregate = scan.sluglines.get(key) ?? {
        key,
        set: reading.value.set,
        variants: new Map<string, { text: string; occurrences: number }>(),
        occurrences: 0,
        scenes: [],
        dayScenes: 0,
        nightScenes: 0,
      }
      aggregate.occurrences += 1
      const variant = aggregate.variants.get(heading) ?? { text: heading, occurrences: 0 }
      variant.occurrences += 1
      aggregate.variants.set(heading, variant)
      pushUnique(aggregate.scenes, node.id)
      if (reading.value.light === 'day') aggregate.dayScenes += 1
      if (reading.value.light === 'night') aggregate.nightScenes += 1
      scan.sluglines.set(key, aggregate)
      noteMentions(node)
      continue
    }

    if (node.type === 'character') {
      const raw = plainText(node.content)
      const reading = readCue(raw)
      const modifiers = mergeModifiers(node.modifiers, reading.modifiers)
      const key = canonicalKey(reading.name)
      if (key === '') {
        cue = undefined
        noteMentions(node)
        continue
      }
      const aggregate = scan.cues.get(key) ?? {
        key,
        name: reading.name,
        variants: new Map<string, CueVariant>(),
        occurrences: 0,
        lines: 0,
        scenes: [],
      }
      const display = writeCue(reading.name, modifiers)
      const variant = aggregate.variants.get(display) ?? {
        cue: display,
        modifiers,
        occurrences: 0,
        lines: 0,
      }
      variant.occurrences += 1
      aggregate.variants.set(display, variant)
      aggregate.occurrences += 1
      scan.cues.set(key, aggregate)
      if (scene !== undefined) {
        pushUnique(scene.cueKeys, key)
        pushUnique(aggregate.scenes, scene.node)
      }
      cue = { aggregate, variant }
      noteMentions(node)
      continue
    }

    if (node.type === 'dialogue') {
      if (cue !== undefined) {
        cue.aggregate.lines += 1
        cue.variant.lines += 1
      }
      if (scene !== undefined) scene.lines += 1
      noteMentions(node)
      continue
    }

    // Action, transition, subtitle and parentheticals: mentions only. An action
    // line ends the speech but not the scene.
    if (node.type === 'action' || node.type === 'transition' || node.type === 'subtitle') {
      cue = undefined
    }
    noteMentions(node)
  }

  return scan
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** A record that exists, or one this pass has decided to mint. */
type Ref =
  | { readonly kind: 'existing'; readonly id: string }
  | { readonly kind: 'mint'; readonly slot: number }

const refKey = (ref: Ref): string =>
  ref.kind === 'existing' ? `id:${ref.id}` : `mint:${String(ref.slot)}`

type Candidate = {
  readonly ref: Ref
  readonly name: string
  readonly nameKey: string
  readonly boundKeys: readonly string[]
}

type ProposalRef = {
  readonly ref: Ref | null
  readonly newParentName: string | null
  readonly confidence: Confidence
}

type Resolution =
  | { readonly kind: 'record'; readonly ref: Ref }
  | {
      readonly kind: 'unresolved'
      readonly proposal: ProposalRef | null
      readonly suppressed: readonly ProposalRef[]
    }

const sameTarget = (a: ProposalTarget, b: ProposalTarget): boolean => {
  if (a.kind !== b.kind) return false
  if (a.kind === 'character' && b.kind === 'character') return a.id === b.id
  if (a.kind === 'location' && b.kind === 'location') return a.id === b.id
  if (a.kind === 'attach' && b.kind === 'attach') return a.parent === b.parent
  if (a.kind === 'new-parent' && b.kind === 'new-parent') return a.name === b.name
  return a.kind === 'new-record' && b.kind === 'new-record'
}

const decidedOn = (
  decisions: readonly ProposalDecision[],
  verdict: ProposalDecision['verdict'],
  target: ProposalTarget,
): boolean =>
  decisions.some((decision) => decision.verdict === verdict && sameTarget(decision.target, target))

/**
 * The best candidate for a subject, and the ones a rejection took away.
 *
 * Sorted by confidence and then by pool order, so the answer does not depend on
 * `Map` iteration or on how the candidate list was assembled.
 */
const scoreCandidates = (
  key: string,
  pool: readonly Candidate[],
): readonly { readonly ref: Ref; readonly confidence: Confidence }[] => {
  const scored: { ref: Ref; confidence: Confidence; order: number }[] = []
  for (let index = 0; index < pool.length; index += 1) {
    const candidate = pool[index]
    if (candidate === undefined) continue
    let best: Confidence | null = compare(key, candidate.nameKey)
    for (const bound of candidate.boundKeys) {
      const score = compare(key, bound)
      if (score === null) continue
      if (best === null || confidenceRank(score) < confidenceRank(best)) best = score
    }
    if (best === null) continue
    scored.push({ ref: candidate.ref, confidence: best, order: index })
  }
  scored.sort((a, b) =>
    confidenceRank(a.confidence) === confidenceRank(b.confidence)
      ? a.order - b.order
      : confidenceRank(a.confidence) - confidenceRank(b.confidence),
  )
  return scored.map(({ ref, confidence }) => ({ ref, confidence }))
}

/** One existing character a cue resembles, and how closely. */
export type CharacterMatch = {
  readonly id: CharacterId
  readonly confidence: Confidence
}

/**
 * Every existing character a cue resembles, best first.
 *
 * The same scoring the queue uses (`scoreCandidates`), over the same pool a
 * pass would build from these records, so the list is exactly what later
 * passes would propose one at a time as each proposal was rejected. That is
 * what the Characters route's "Walk-on" needs: to say "this cue is nobody"
 * in one act, it rejects every one of these and `new-record` together, and
 * the row then stands open with no proposal - the state `resolveSubject`
 * documents as the writer having said this cue must never be asked about
 * again. Nothing here binds; it is a list for a human to decide over.
 *
 * `cue` is read with `readCue`, so modifiers come off before matching, as
 * they do in a pass.
 */
export const matchCharacters = (
  cue: string,
  characters: readonly CharacterRecord[],
): readonly CharacterMatch[] => {
  const key = canonicalKey(readCue(cue).name)
  if (key === '') return []
  const pool: Candidate[] = characters.map((record) => ({
    ref: { kind: 'existing', id: record.id },
    name: record.authored.name,
    nameKey: canonicalKey(record.authored.name),
    boundKeys: record.authored.boundCues.map(canonicalKey),
  }))
  return scoreCandidates(key, pool).flatMap(({ ref, confidence }) =>
    ref.kind === 'existing' ? [{ id: characterId(ref.id), confidence }] : [],
  )
}

const NEW_RECORD: ProposalTarget = { kind: 'new-record' }

/**
 * Resolve one subject against the pool, honouring the writer's decisions.
 *
 * The order of the branches is the design:
 *
 *   1. An exact bound key is a match. Nothing else is.
 *   2. A surviving candidate is a **proposal**, not a match - the row stays open
 *      and the record is not minted, because a cue that resembles someone is the
 *      case where guessing wrong merges two people.
 *   3. Nothing resembles it at all, and no rejection stands: mint. This is the
 *      ordinary case for a script's first derivation - every cue is new and
 *      nothing is ambiguous, so 40 characters appear and the queue stays empty.
 *   4. Everything was rejected: offer `new-record`, and if that was rejected
 *      too, the row stands open with no proposal. That last state is the
 *      "Walk-on" button in the Characters bundle - the writer has said this cue
 *      is nobody, and it must never be asked again.
 */
const resolveSubject = (
  key: string,
  entity: 'character' | 'location',
  bound: ReadonlyMap<string, Ref[]>,
  pool: readonly Candidate[],
  decisions: readonly ProposalDecision[],
  mint: () => Ref,
  ambiguous: (refs: readonly Ref[]) => void,
): Resolution => {
  const exact = bound.get(key)
  if (exact !== undefined && exact.length > 0) {
    const first = exact[0]
    if (first !== undefined) {
      if (exact.length > 1) ambiguous(exact)
      return { kind: 'record', ref: first }
    }
  }

  const scored = scoreCandidates(key, pool)
  const surviving: ProposalRef[] = []
  const suppressed: ProposalRef[] = []
  for (const candidate of scored) {
    const proposal: ProposalRef = {
      ref: candidate.ref,
      newParentName: null,
      confidence: candidate.confidence,
    }
    // A mint has an id nobody has seen, so no decision can stand against it.
    const rejected =
      candidate.ref.kind === 'existing' &&
      decidedOn(
        decisions,
        'rejected',
        entity === 'character'
          ? { kind: 'character', id: characterId(candidate.ref.id) }
          : { kind: 'location', id: locationId(candidate.ref.id) },
      )
    if (rejected) suppressed.push(proposal)
    else surviving.push(proposal)
  }

  const acceptedNew = decidedOn(decisions, 'accepted', NEW_RECORD)
  const rejectedNew = decidedOn(decisions, 'rejected', NEW_RECORD)

  const best = surviving[0]
  if (best !== undefined && !acceptedNew) {
    return { kind: 'unresolved', proposal: best, suppressed }
  }
  if (acceptedNew || (scored.length === 0 && !rejectedNew)) {
    return { kind: 'record', ref: mint() }
  }
  if (!rejectedNew) {
    return {
      kind: 'unresolved',
      proposal: { ref: null, newParentName: null, confidence: 'possible' },
      suppressed,
    }
  }
  return { kind: 'unresolved', proposal: null, suppressed }
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

type MintPlan =
  | { readonly kind: 'character'; readonly name: string; readonly cue: string }
  | { readonly kind: 'location'; readonly name: string; readonly slugline: string }

type StructurePlan = {
  readonly location: Ref
  readonly key: string
  readonly proposal: ProposalRef | null
  readonly suppressed: readonly ProposalRef[]
  readonly settled: boolean
}

type Plan = {
  readonly scan: Scan
  readonly mints: readonly MintPlan[]
  readonly cueResolution: ReadonlyMap<string, Resolution>
  readonly sluglineResolution: ReadonlyMap<string, Resolution>
  readonly structure: readonly StructurePlan[]
  readonly ambiguousBindings: readonly AmbiguousBinding[]
}

const decisionsFor = (
  previous: DerivedEntities,
  subject: ResolveSubject,
): readonly ProposalDecision[] => {
  const wanted = resolveRowKey(subject)
  const row = previous.queue.find((candidate) => resolveRowKey(candidate.subject) === wanted)
  return row === undefined ? [] : row.decisions
}

/**
 * Everything derivation decides, before a single id is spent.
 *
 * Split out for the same reason `fdx.ts` splits `scan` from `importFinalDraft`:
 * `countDerivationIds` needs the answer to "how many records will be minted?"
 * and the only honest way to get it is to make every decision that leads to a
 * mint. It is not a second derivation path - it is the first half of the only
 * one, and `derive` calls exactly this.
 */
const plan = (nodes: readonly ScreenplayNode[], previous: DerivedEntities): Plan => {
  const scan = scanNodes(nodes)
  const mints: MintPlan[] = []
  const ambiguousBindings: AmbiguousBinding[] = []

  // --- characters -----------------------------------------------------------
  const characterPool: Candidate[] = previous.characters.map((record) => ({
    ref: { kind: 'existing', id: record.id },
    name: record.authored.name,
    nameKey: canonicalKey(record.authored.name),
    boundKeys: record.authored.boundCues.map(canonicalKey),
  }))
  const boundCues = new Map<string, Ref[]>()
  for (const record of previous.characters) {
    for (const cue of record.authored.boundCues) {
      const key = canonicalKey(cue)
      if (key === '') continue
      const refs = boundCues.get(key) ?? []
      if (!refs.some((ref) => ref.kind === 'existing' && ref.id === record.id)) {
        refs.push({ kind: 'existing', id: record.id })
      }
      boundCues.set(key, refs)
    }
  }

  const cueResolution = new Map<string, Resolution>()
  for (const [key, aggregate] of scan.cues) {
    const subject: ResolveSubject = { kind: 'cue', key, cue: aggregate.name }
    const resolution = resolveSubject(
      key,
      'character',
      boundCues,
      characterPool,
      decisionsFor(previous, subject),
      () => {
        const slot = mints.length
        mints.push({ kind: 'character', name: aggregate.name, cue: aggregate.name })
        const ref: Ref = { kind: 'mint', slot }
        // A record minted this pass is a candidate for every later cue, so a
        // script that introduces MEERA and then MEERA PAWAR proposes rather
        // than quietly minting a second person. See the header.
        characterPool.push({ ref, name: aggregate.name, nameKey: key, boundKeys: [key] })
        boundCues.set(key, [ref])
        return ref
      },
      (refs) =>
        ambiguousBindings.push({
          kind: 'cue',
          key,
          records: refs.flatMap((ref) => (ref.kind === 'existing' ? [ref.id] : [])),
        }),
    )
    cueResolution.set(key, resolution)
  }

  // --- locations ------------------------------------------------------------
  const locationPool: Candidate[] = previous.locations.map((record) => ({
    ref: { kind: 'existing', id: record.id },
    name: record.authored.name,
    nameKey: canonicalKey(record.authored.name),
    boundKeys: record.authored.boundSluglines.map(canonicalKey),
  }))
  const boundSluglines = new Map<string, Ref[]>()
  for (const record of previous.locations) {
    for (const slugline of record.authored.boundSluglines) {
      const key = canonicalKey(slugline)
      if (key === '') continue
      const refs = boundSluglines.get(key) ?? []
      if (!refs.some((ref) => ref.kind === 'existing' && ref.id === record.id)) {
        refs.push({ kind: 'existing', id: record.id })
      }
      boundSluglines.set(key, refs)
    }
  }

  const sluglineResolution = new Map<string, Resolution>()
  for (const [key, aggregate] of scan.sluglines) {
    const subject: ResolveSubject = { kind: 'slugline', key, slugline: aggregate.set }
    const resolution = resolveSubject(
      key,
      'location',
      boundSluglines,
      locationPool,
      decisionsFor(previous, subject),
      () => {
        const slot = mints.length
        mints.push({ kind: 'location', name: aggregate.set, slugline: aggregate.set })
        const ref: Ref = { kind: 'mint', slot }
        locationPool.push({ ref, name: aggregate.set, nameKey: key, boundKeys: [key] })
        boundSluglines.set(key, [ref])
        return ref
      },
      (refs) =>
        ambiguousBindings.push({
          kind: 'slugline',
          key,
          records: refs.flatMap((ref) => (ref.kind === 'existing' ? [ref.id] : [])),
        }),
    )
    sluglineResolution.set(key, resolution)
  }

  return {
    scan,
    mints,
    cueResolution,
    sluglineResolution,
    structure: planStructure(previous, locationPool),
    ambiguousBindings,
  }
}

/** ` - ` again, kept in step with `slugline.ts` by using the same shape of split. */
const SEGMENTS = /\s+[-–—]{1,2}\s+|\s*--\s*/u

/**
 * Structure proposals: the only place hierarchy is ever suggested.
 *
 * A record whose own name reads as `<head> - <rest>` is a candidate sub-set. Two
 * proposals are possible and neither is an edit:
 *
 *   - `attach` - a record already exists that the head names.
 *   - `new-parent` - no such record exists, but **two or more** sets share the
 *     head, so the primary set is implied by the script rather than by one
 *     hopeful split. One set alone with a dash in its name proposes nothing;
 *     that is how `INT. THE MILL - OFFICE` avoids inventing a mill.
 */
const planStructure = (
  previous: DerivedEntities,
  pool: readonly Candidate[],
): readonly StructurePlan[] => {
  const headCount = new Map<string, number>()
  const byKey = new Map<string, Ref>()
  const entries: { ref: Ref; head: string; headKey: string }[] = []

  for (const candidate of pool) {
    if (!byKey.has(candidate.nameKey)) byKey.set(candidate.nameKey, candidate.ref)
    for (const bound of candidate.boundKeys) {
      if (!byKey.has(bound)) byKey.set(bound, candidate.ref)
    }
    const segments = candidate.name.split(SEGMENTS).map((segment) => segment.trim())
    const head = segments[0]
    if (segments.length < 2 || head === undefined || head === '') continue
    const headKey = canonicalKey(head)
    if (headKey === '') continue
    headCount.set(headKey, (headCount.get(headKey) ?? 0) + 1)
    entries.push({ ref: candidate.ref, head, headKey })
  }

  const rows: StructurePlan[] = []
  for (const entry of entries) {
    const ref = entry.ref
    const record =
      ref.kind === 'existing'
        ? previous.locations.find((candidate) => candidate.id === ref.id)
        : undefined
    const key = ref.kind === 'existing' ? ref.id : refKey(ref)
    const parent = byKey.get(entry.headKey)

    const proposal: ProposalRef | null =
      parent !== undefined && refKey(parent) !== refKey(entry.ref)
        ? { ref: parent, newParentName: null, confidence: 'likely' }
        : (headCount.get(entry.headKey) ?? 0) > 1
          ? { ref: null, newParentName: entry.head, confidence: 'likely' }
          : null
    if (proposal === null) continue

    const target: ProposalTarget =
      proposal.ref !== null && proposal.ref.kind === 'existing'
        ? { kind: 'attach', parent: locationId(proposal.ref.id) }
        : { kind: 'new-parent', name: entry.head }
    const decisions =
      record === undefined
        ? []
        : decisionsFor(previous, { kind: 'structure', key, location: locationId(record.id) })
    const rejected = decidedOn(decisions, 'rejected', target)

    rows.push({
      location: entry.ref,
      key,
      proposal: rejected ? null : proposal,
      suppressed: rejected ? [proposal] : [],
      settled: record !== undefined && record.authored.parent !== null,
    })
  }
  return rows
}

/**
 * How many ids a derivation of this node list will need.
 *
 * Answered before any is spent, like `countFdxNodes`. Zero on a re-derive of an
 * unchanged script, which is worth knowing: a pass that suddenly wants ids is a
 * pass that is about to create people.
 */
export const countDerivationIds = (
  nodes: readonly ScreenplayNode[],
  previous: DerivedEntities,
): number => plan(nodes, previous).mints.length

// ---------------------------------------------------------------------------
// Building the records
// ---------------------------------------------------------------------------

const EMPTY_SCENE_AUTHORED: SceneAuthored = {
  synopsis: null,
  storyTime: null,
  beats: [],
  threads: [],
  notes: {},
}

const countsOf = (parts: {
  scenes: number
  sluglines: number
  dayScenes: number
  nightScenes: number
  shootingDays: number
}): LocationCounts => parts

const addCounts = (a: LocationCounts, b: LocationCounts): LocationCounts => ({
  scenes: a.scenes + b.scenes,
  sluglines: a.sluglines + b.sluglines,
  dayScenes: a.dayScenes + b.dayScenes,
  nightScenes: a.nightScenes + b.nightScenes,
  shootingDays: a.shootingDays + b.shootingDays,
})

const presenceOf = (occurrences: number): Presence => (occurrences > 0 ? 'present' : 'absent')

export const derive = (
  nodes: readonly ScreenplayNode[],
  previous: DerivedEntities,
  options: DeriveOptions,
): Result<Derivation, DeriveError> => {
  const seenRecordIds = new Set<string>()
  for (const record of previous.characters) {
    if (seenRecordIds.has(record.id)) return err({ kind: 'duplicate-record-id', id: record.id })
    seenRecordIds.add(record.id)
  }
  for (const record of previous.locations) {
    if (seenRecordIds.has(record.id)) return err({ kind: 'duplicate-record-id', id: record.id })
    seenRecordIds.add(record.id)
  }

  const planned = plan(nodes, previous)
  const needed = planned.mints.length
  const supplied = options.freshIds.length
  if (supplied < needed) return err({ kind: 'not-enough-ids', needed, supplied })

  const spent = new Set<string>()
  for (let index = 0; index < needed; index += 1) {
    const id = options.freshIds[index]
    if (id === undefined || id === '') return err({ kind: 'empty-id', index })
    if (spent.has(id)) return err({ kind: 'duplicate-id', id })
    if (seenRecordIds.has(id)) return err({ kind: 'id-already-in-use', id })
    spent.add(id)
  }

  const idOfSlot = (slot: number): string => options.freshIds[slot] ?? ''
  const idOfRef = (ref: Ref): string => (ref.kind === 'existing' ? ref.id : idOfSlot(ref.slot))

  const minted: MintedRecord[] = planned.mints.map((mint, slot) =>
    mint.kind === 'character'
      ? { kind: 'character', id: characterId(idOfSlot(slot)), from: mint.cue }
      : { kind: 'location', id: locationId(idOfSlot(slot)), from: mint.slugline },
  )

  // --- resolved ids by key --------------------------------------------------
  const characterOfCue = new Map<string, CharacterId>()
  for (const [key, resolution] of planned.cueResolution) {
    if (resolution.kind === 'record') characterOfCue.set(key, characterId(idOfRef(resolution.ref)))
  }
  const locationOfSlugline = new Map<string, LocationId>()
  for (const [key, resolution] of planned.sluglineResolution) {
    if (resolution.kind === 'record') {
      locationOfSlugline.set(key, locationId(idOfRef(resolution.ref)))
    }
  }

  // --- characters -----------------------------------------------------------
  const cueKeysOf = new Map<string, string[]>()
  for (const [key, id] of characterOfCue) {
    const keys = cueKeysOf.get(id) ?? []
    keys.push(key)
    cueKeysOf.set(id, keys)
  }

  const mentionScenes = new Map<string, NodeId[]>()
  for (const scene of planned.scan.scenes) {
    for (const id of scene.mentions) {
      const scenes = mentionScenes.get(id) ?? []
      pushUnique(scenes, scene.node)
      mentionScenes.set(id, scenes)
    }
  }

  const buildCharacter = (
    id: CharacterId,
    authored: CharacterAuthored,
  ): CharacterRecord => {
    const keys = cueKeysOf.get(id) ?? []
    const cues = keys.flatMap((key) => {
      const aggregate = planned.scan.cues.get(key)
      if (aggregate === undefined) return []
      return [...aggregate.variants.values()].map((variant) => ({
        cue: variant.cue,
        key,
        modifiers: variant.modifiers,
        occurrences: variant.occurrences,
        lines: variant.lines,
      }))
    })
    const scenes: NodeId[] = []
    for (const scene of planned.scan.scenes) {
      const speaks = scene.cueKeys.some((key) => characterOfCue.get(key) === id)
      const mentioned = scene.mentions.includes(id)
      if (speaks || mentioned) scenes.push(scene.node)
    }
    const lines = keys.reduce((total, key) => total + (planned.scan.cues.get(key)?.lines ?? 0), 0)
    const occurrences = keys.reduce(
      (total, key) => total + (planned.scan.cues.get(key)?.occurrences ?? 0),
      0,
    )
    const mentions = planned.scan.mentionedCharacters.get(id)?.count ?? 0
    return {
      id,
      authored,
      cues,
      appearances: scenes.length,
      scenes,
      lines,
      mentions,
      presence: presenceOf(occurrences + mentions),
    }
  }

  const characters: CharacterRecord[] = previous.characters.map((record) =>
    buildCharacter(record.id, record.authored),
  )
  planned.mints.forEach((mint, slot) => {
    if (mint.kind !== 'character') return
    const id = characterId(idOfSlot(slot))
    characters.push(
      buildCharacter(id, {
        name: mint.name,
        boundCues: [mint.cue],
        bio: null,
        relationships: [],
        notes: {},
      }),
    )
  })

  // --- locations ------------------------------------------------------------
  const sluglineKeysOf = new Map<string, string[]>()
  for (const [key, id] of locationOfSlugline) {
    const keys = sluglineKeysOf.get(id) ?? []
    keys.push(key)
    sluglineKeysOf.set(id, keys)
  }

  const locationDraft = (
    id: LocationId,
    authored: LocationAuthored,
  ): {
    id: LocationId
    authored: LocationAuthored
    sluglines: { slugline: string; key: string; occurrences: number }[]
    own: LocationCounts
    scenes: NodeId[]
  } => {
    const keys = sluglineKeysOf.get(id) ?? []
    const sluglines = keys.flatMap((key) => {
      const aggregate = planned.scan.sluglines.get(key)
      if (aggregate === undefined) return []
      return [...aggregate.variants.values()].map((variant) => ({
        slugline: variant.text,
        key,
        occurrences: variant.occurrences,
      }))
    })
    const scenes: NodeId[] = []
    let day = 0
    let night = 0
    for (const key of keys) {
      const aggregate = planned.scan.sluglines.get(key)
      if (aggregate === undefined) continue
      day += aggregate.dayScenes
      night += aggregate.nightScenes
    }
    for (const scene of planned.scan.scenes) {
      if (locationOfSlugline.get(scene.sluglineKey) === id) scenes.push(scene.node)
    }
    return {
      id,
      authored,
      sluglines,
      scenes,
      own: countsOf({
        scenes: scenes.length,
        sluglines: sluglines.length,
        dayScenes: day,
        nightScenes: night,
        shootingDays: authored.scheduledDays,
      }),
    }
  }

  const drafts = previous.locations.map((record) => locationDraft(record.id, record.authored))
  planned.mints.forEach((mint, slot) => {
    if (mint.kind !== 'location') return
    drafts.push(
      locationDraft(locationId(idOfSlot(slot)), {
        name: mint.name,
        parent: null,
        boundSluglines: [mint.slugline],
        scheduledDays: 0,
        description: null,
        notes: {},
      }),
    )
  })

  const brokenEdges: BrokenLocationEdge[] = []
  const draftById = new Map(drafts.map((draft) => [String(draft.id), draft]))

  /** Walk up, capped by the record count, so a cycle is data rather than a hang. */
  const parentOf = (id: LocationId): LocationId | null => {
    const draft = draftById.get(String(id))
    if (draft === undefined) return null
    const parent = draft.authored.parent
    if (parent === null) return null
    if (!draftById.has(String(parent))) {
      brokenEdges.push({ location: id, parent, reason: 'unknown-parent' })
      return null
    }
    let walker: LocationId | null = parent
    for (let step = 0; step <= drafts.length; step += 1) {
      if (walker === null) return parent
      if (walker === id) {
        brokenEdges.push({ location: id, parent, reason: 'cycle' })
        return null
      }
      const next: LocationId | null = draftById.get(String(walker))?.authored.parent ?? null
      walker = next
    }
    brokenEdges.push({ location: id, parent, reason: 'cycle' })
    return null
  }

  const effectiveParent = new Map<string, LocationId | null>()
  for (const draft of drafts) effectiveParent.set(String(draft.id), parentOf(draft.id))

  const childrenOf = new Map<string, LocationId[]>()
  for (const draft of drafts) {
    const parent = effectiveParent.get(String(draft.id)) ?? null
    if (parent === null) continue
    const children = childrenOf.get(String(parent)) ?? []
    children.push(draft.id)
    childrenOf.set(String(parent), children)
  }

  const depthOf = (id: LocationId): number => {
    let depth = 0
    let walker = effectiveParent.get(String(id)) ?? null
    while (walker !== null && depth <= drafts.length) {
      depth += 1
      walker = effectiveParent.get(String(walker)) ?? null
    }
    return depth
  }

  /**
   * The roll-up. AGENTS.md, Entity identity: a flat list "cannot answer 'how
   * many days in the chawl'", so every count a set carries is also summed over
   * its descendants.
   */
  const rollupOf = (id: LocationId): LocationCounts => {
    const draft = draftById.get(String(id))
    if (draft === undefined) return NO_COUNTS
    let total = draft.own
    for (const child of childrenOf.get(String(id)) ?? []) total = addCounts(total, rollupOf(child))
    return total
  }

  const locations: LocationRecord[] = drafts.map((draft) => ({
    id: draft.id,
    authored: draft.authored,
    sluglines: draft.sluglines,
    children: childrenOf.get(String(draft.id)) ?? [],
    depth: depthOf(draft.id),
    own: draft.own,
    rollup: rollupOf(draft.id),
    scenes: draft.scenes,
    presence: presenceOf(draft.own.sluglines),
  }))

  // --- scenes ---------------------------------------------------------------
  const previousScene = new Map(previous.scenes.map((scene) => [String(scene.id), scene]))
  const scenes: SceneRecord[] = planned.scan.scenes.map((scan, index) => {
    const speaking: CharacterId[] = []
    const unresolvedCues: string[] = []
    for (const key of scan.cueKeys) {
      const id = characterOfCue.get(key)
      if (id === undefined) {
        const aggregate = planned.scan.cues.get(key)
        if (aggregate !== undefined) pushUnique(unresolvedCues, aggregate.name)
        continue
      }
      pushUnique(speaking, id)
    }
    const mentioned = scan.mentions.filter((id) => !speaking.includes(id))
    const cast = [...speaking, ...mentioned]
    return {
      id: scan.node,
      number: index + 1,
      heading: scan.heading,
      reading: scan.reading,
      locationId: locationOfSlugline.get(scan.sluglineKey) ?? null,
      cast,
      speaking,
      mentioned,
      unresolvedCues,
      castSize: cast.length,
      lines: scan.lines,
      presence: 'present',
      authored: previousScene.get(String(scan.node))?.authored ?? EMPTY_SCENE_AUTHORED,
    }
  })
  const present = new Set(scenes.map((scene) => String(scene.id)))
  for (const scene of previous.scenes) {
    if (present.has(String(scene.id))) continue
    scenes.push({
      ...scene,
      number: 0,
      locationId: null,
      cast: [],
      speaking: [],
      mentioned: [],
      unresolvedCues: [],
      castSize: 0,
      lines: 0,
      presence: 'absent',
      authored: scene.authored,
    })
  }

  // --- the queue ------------------------------------------------------------
  const rows = new Map<string, ResolveRow>()
  const targetOf = (proposal: ProposalRef, kind: 'character' | 'location' | 'attach'): Proposal => {
    if (proposal.newParentName !== null) {
      return { target: { kind: 'new-parent', name: proposal.newParentName }, confidence: proposal.confidence }
    }
    if (proposal.ref === null) return { target: NEW_RECORD, confidence: proposal.confidence }
    const id = idOfRef(proposal.ref)
    if (kind === 'character') {
      return { target: { kind: 'character', id: characterId(id) }, confidence: proposal.confidence }
    }
    if (kind === 'attach') {
      return { target: { kind: 'attach', parent: locationId(id) }, confidence: proposal.confidence }
    }
    return { target: { kind: 'location', id: locationId(id) }, confidence: proposal.confidence }
  }

  const addRow = (
    subject: ResolveSubject,
    parts: {
      occurrences: number
      scenes: readonly NodeId[]
      proposal: Proposal | null
      suppressed: readonly Proposal[]
      state: ResolveRowState
    },
  ): void => {
    const key = resolveRowKey(subject)
    const before = previous.queue.find((row) => resolveRowKey(row.subject) === key)
    rows.set(key, {
      subject,
      occurrences: parts.occurrences,
      scenes: parts.scenes,
      proposal: parts.proposal,
      suppressed: parts.suppressed,
      state: parts.state,
      // Authored. Carried by reference; this is the whole promise of the file.
      decisions: before?.decisions ?? [],
    })
  }

  for (const [key, aggregate] of planned.scan.cues) {
    const resolution = planned.cueResolution.get(key)
    if (resolution === undefined) continue
    const subject: ResolveSubject = { kind: 'cue', key, cue: aggregate.name }
    const known = previous.queue.some((row) => resolveRowKey(row.subject) === resolveRowKey(subject))
    if (resolution.kind === 'record') {
      if (!known) continue
      addRow(subject, {
        occurrences: aggregate.occurrences,
        scenes: aggregate.scenes,
        proposal: null,
        suppressed: [],
        state: 'settled',
      })
      continue
    }
    addRow(subject, {
      occurrences: aggregate.occurrences,
      scenes: aggregate.scenes,
      proposal: resolution.proposal === null ? null : targetOf(resolution.proposal, 'character'),
      suppressed: resolution.suppressed.map((entry) => targetOf(entry, 'character')),
      state: 'open',
    })
  }

  for (const [key, aggregate] of planned.scan.sluglines) {
    const resolution = planned.sluglineResolution.get(key)
    if (resolution === undefined) continue
    const subject: ResolveSubject = { kind: 'slugline', key, slugline: aggregate.set }
    const known = previous.queue.some((row) => resolveRowKey(row.subject) === resolveRowKey(subject))
    if (resolution.kind === 'record') {
      if (!known) continue
      addRow(subject, {
        occurrences: aggregate.occurrences,
        scenes: aggregate.scenes,
        proposal: null,
        suppressed: [],
        state: 'settled',
      })
      continue
    }
    addRow(subject, {
      occurrences: aggregate.occurrences,
      scenes: aggregate.scenes,
      proposal: resolution.proposal === null ? null : targetOf(resolution.proposal, 'location'),
      suppressed: resolution.suppressed.map((entry) => targetOf(entry, 'location')),
      state: 'open',
    })
  }

  for (const row of planned.structure) {
    const id = locationId(idOfRef(row.location))
    const draft = draftById.get(String(id))
    const subject: ResolveSubject = { kind: 'structure', key: String(id), location: id }
    addRow(subject, {
      occurrences: draft?.own.scenes ?? 0,
      scenes: draft?.scenes ?? [],
      proposal: row.proposal === null ? null : targetOf(row.proposal, 'attach'),
      suppressed: row.suppressed.map((entry) => targetOf(entry, 'attach')),
      state: row.settled ? 'settled' : 'open',
    })
  }

  // Rows whose subject has left the script keep their decisions and say so.
  const queue: ResolveRow[] = []
  for (const before of previous.queue) {
    const key = resolveRowKey(before.subject)
    const now = rows.get(key)
    if (now !== undefined) {
      queue.push(now)
      rows.delete(key)
      continue
    }
    queue.push({
      subject: before.subject,
      occurrences: 0,
      scenes: [],
      proposal: null,
      suppressed: [],
      state: 'gone',
      decisions: before.decisions,
    })
  }
  for (const row of rows.values()) queue.push(row)

  // --- mentions that point nowhere -----------------------------------------
  const characterIds = new Set(characters.map((record) => String(record.id)))
  const locationIds = new Set(locations.map((record) => String(record.id)))
  const danglingMentions: DanglingMention[] = planned.scan.mentionNodes.filter((mention) =>
    mention.target.entity === 'character'
      ? !characterIds.has(String(mention.target.id))
      : !locationIds.has(String(mention.target.id)),
  )

  return ok({
    entities: { characters, locations, scenes, queue },
    minted,
    unusedIds: options.freshIds.slice(needed),
    rejectedHeadings: planned.scan.rejectedHeadings,
    danglingMentions,
    brokenEdges,
    ambiguousBindings: planned.ambiguousBindings,
  })
}
