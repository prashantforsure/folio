import { InlineContentSchema, LocationEditSchema, LocationIdSchema, ParentEditSchema, TitleSchema } from '@folio/contracts'
import {
  bindSlugline,
  createLocationRecord,
  deleteAbsentLocation,
  deleteBlankLocation,
  deleteResolveDecisions,
  listBoundSluglines,
  listEpisodes,
  listLocationRecords,
  listOpenLocationRows,
  listResolveDecisions,
  mergeLocationRecords,
  proposalTargetKey,
  readDocumentByKind,
  readScreenplayNodes,
  recordResolveDecisions,
  renameLocationRecord,
  rewriteHeadingNodes,
  setLocationParent,
  snapshotVersion,
  unbindSlugline,
  updateLocationRecord,
} from '@folio/db'
import type { HeadingNodeRewrite, ProjectScope } from '@folio/db'
import type { LocationId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey, renameLocationHeadings, setSpelling } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import type { ProjectGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import { requestRederive } from '../script/derive-batch'
import { deleteObject, storageAvailable } from '../storage/r2'
import { wouldCycle } from './figures'
import type { CreateResult, DeleteResult, HeadingRestore, MergeResult, RenameDone, RenamePreview, ResolveResult, SavedResult, UndoRenameResult } from './result'

/**
 * The Locations route's writes as **core functions** - roadmap task 4.2.
 *
 * The Characters route's split (`lib/characters/core.ts`): each takes a gate
 * already opened and the raw input its action takes, checks the role itself,
 * and does everything the action did after its gate except `revalidatePath`,
 * which stays with the action (`actions.ts`, whose header is the route's
 * account of each write). The agent's tools and the worker call these with a
 * gate of their own; nothing here reads a cookie or reaches Next.
 */

const REFUSED_LOCATION = 'That location could not be found.'
const NAME_SHAPE = 'A location needs a name, up to 200 characters.'
const UNREADABLE_DECISION = 'That decision could not be read.'

type Problem = { readonly status: 'error'; readonly message: string }

const parseId = (raw: unknown): LocationId | null => {
  const parsed = LocationIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export const createLocationProblem = (rawName: unknown, rawParent: unknown, rawKey: unknown): Problem | null => {
  if (!TitleSchema.safeParse(rawName).success || !ParentEditSchema.safeParse(rawParent ?? null).success) return { status: 'error', message: NAME_SHAPE }
  if (!idempotencyKeyOf(rawKey).ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  return null
}

export const createLocationWith = async (gate: ProjectGate, rawName: unknown, rawParent: unknown = null, rawKey: unknown = null): Promise<CreateResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const name = TitleSchema.safeParse(rawName)
  const parent = ParentEditSchema.safeParse(rawParent ?? null)
  if (!name.success || !parent.success) return { status: 'error', message: NAME_SHAPE }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }

  const id = await createLocationRecord(gate.scope, name.data, parent.data, key.key)
  // The name's set text binds to the new record, so a heading typed later
  // resolves to it rather than proposing. A set somebody else already holds
  // is left with them; the writer sees it in the queue.
  await bindSlugline(gate.scope, id, setSpelling(name.data))
  await requestRederive(gate.scope)
  return { status: 'created', id }
}

export const locationEditProblem = (rawId: unknown, rawEdit: unknown): Problem | null =>
  parseId(rawId) === null || !LocationEditSchema.safeParse(rawEdit).success ? { status: 'error', message: 'That edit could not be read.' } : null

export const saveLocationWith = async (gate: ProjectGate, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const edit = LocationEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That edit could not be read.' }
  const written = await updateLocationRecord(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_LOCATION }
  return { status: 'saved' }
}

export const renameProblem = (rawId: unknown, rawName: unknown): Problem | null =>
  parseId(rawId) === null || !TitleSchema.safeParse(rawName).success ? { status: 'error', message: NAME_SHAPE } : null

/**
 * The record-level rename - the second sanctioned write-back. The old name's
 * bound set texts are swapped for the new spelling, and the headings carrying
 * the old set are rewritten in every episode, each with its two readings kept
 * for the undo.
 */
export const renameLocationWith = async (gate: ProjectGate, rawId: unknown, rawName: unknown): Promise<RenameDone> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: NAME_SHAPE }
  const { scope } = gate

  const [records, bound] = await Promise.all([listLocationRecords(scope), listBoundSluglines(scope)])
  const record = records.find((entry) => entry.id === id)
  if (record === undefined) return { status: 'error', message: REFUSED_LOCATION }
  const oldKey = canonicalKey(record.name)
  const oldSluglines = bound
    .filter((entry) => entry.locationId === id && canonicalKey(entry.slugline) === oldKey)
    .map((entry) => entry.slugline)
  const newSlugline = setSpelling(name.data)

  const outcome = await renameLocationRecord(scope, id, name.data, oldSluglines, newSlugline)
  if (outcome.status === 'taken') {
    const holder = records.find((entry) => entry.id === outcome.by)
    return { status: 'taken', by: outcome.by, name: holder?.name ?? 'another location', slugline: newSlugline }
  }
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_LOCATION }

  // The rewrite, episode by episode: a `before_rename` version of every
  // script that changes, then every changed heading in one statement - and
  // each heading's two readings kept for the undo.
  let episodesTouched = 0
  const pending: HeadingNodeRewrite[] = []
  const restores: HeadingRestore[] = []
  for (const episode of await listEpisodes(scope)) {
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    if (document === null) continue
    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) continue
    const before = read.value.map((entry) => entry.node)
    const result = renameLocationHeadings(before, record.name, name.data)
    if (result.rewritten.length === 0) continue
    episodesTouched += 1
    await snapshotVersion(scope, document.id, 'before_rename', before, before.length)
    const changed = new Set(result.rewritten)
    const beforeById = new Map(before.map((node) => [node.id, node.content]))
    for (const node of result.nodes) {
      if (!changed.has(node.id)) continue
      pending.push({ id: node.id, content: node.content })
      const previous = beforeById.get(node.id)
      if (previous !== undefined) restores.push({ id: node.id, before: previous, after: node.content })
    }
  }
  const headings = await rewriteHeadingNodes(scope, pending)
  await requestRederive(scope)
  return {
    status: 'renamed',
    headings,
    episodes: episodesTouched,
    undo: { locationId: id, previousName: record.name, name: name.data, restores },
  }
}

/**
 * What a rename would do, before it does: the headings per episode the
 * write-back would rewrite, the bound set texts it leaves alone, and whether
 * the new set text is already another record's. A pure read.
 */
export const previewRenameWith = async (gate: ProjectGate, rawId: unknown, rawName: unknown): Promise<RenamePreview> => {
  const refused = roleRefusal(gate, ROLE.read)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: NAME_SHAPE }
  const { scope } = gate

  const [records, bound, episodes] = await Promise.all([listLocationRecords(scope), listBoundSluglines(scope), listEpisodes(scope)])
  const record = records.find((entry) => entry.id === id)
  if (record === undefined) return { status: 'error', message: REFUSED_LOCATION }
  const oldKey = canonicalKey(record.name)
  const newSlugline = setSpelling(name.data)
  const newKey = canonicalKey(newSlugline)

  // Three waves of reads rather than two per episode in series.
  const documents = await Promise.all(episodes.map((episode) => readDocumentByKind(scope, episode.id, 'screenplay')))
  const reads = await Promise.all(
    documents.map((document) => (document === null ? Promise.resolve(null) : readScreenplayNodes(scope, document.id))),
  )
  const perEpisode = episodes.flatMap((episode, index) => {
    const read = reads[index]
    if (read === null || read === undefined || !read.ok) return []
    const nodes = read.value.map((entry) => entry.node)
    const headings = renameLocationHeadings(nodes, record.name, name.data).rewritten.length
    return headings === 0 ? [] : [{ ordinal: episode.ordinal, headings }]
  })
  const stays = bound
    .filter((entry) => entry.locationId === id)
    .map((entry) => entry.slugline)
    .filter((slugline) => {
      const key = canonicalKey(slugline)
      return key !== oldKey && key !== newKey
    })
  const holder = bound.find((entry) => entry.locationId !== id && entry.slugline === newSlugline)
  const holderRecord = holder === undefined ? undefined : records.find((entry) => entry.id === holder.locationId)
  return {
    status: 'preview',
    to: newSlugline,
    headings: perEpisode.reduce((total, entry) => total + entry.headings, 0),
    episodes: perEpisode,
    stays,
    taken: holder === undefined ? null : { by: holder.locationId, name: holderRecord?.name ?? 'another location' },
  }
}

const UndoRenameSchema = z.object({
  locationId: LocationIdSchema,
  previousName: TitleSchema,
  name: TitleSchema,
  restores: z.array(z.object({ id: z.string().min(1), before: InlineContentSchema, after: InlineContentSchema })).max(5000),
})

export const undoRenameProblem = (rawUndo: unknown): Problem | null =>
  UndoRenameSchema.safeParse(rawUndo).success ? null : { status: 'error', message: 'That rename could not be taken back.' }

/**
 * Take a rename back: the record's old name and set text, then every heading
 * the rename rewrote whose content is still exactly what the rename left - a
 * heading edited since is left as it is and counted as skipped.
 */
export const undoRenameWith = async (gate: ProjectGate, rawUndo: unknown): Promise<UndoRenameResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const undo = UndoRenameSchema.safeParse(rawUndo)
  if (!undo.success) return { status: 'error', message: 'That rename could not be taken back.' }
  const { scope } = gate
  const { locationId, previousName, name, restores } = undo.data

  const [records, bound] = await Promise.all([listLocationRecords(scope), listBoundSluglines(scope)])
  const record = records.find((entry) => entry.id === locationId)
  if (record === undefined) return { status: 'error', message: REFUSED_LOCATION }
  const currentKey = canonicalKey(name)
  const current = bound.filter((entry) => entry.locationId === locationId && canonicalKey(entry.slugline) === currentKey).map((entry) => entry.slugline)
  const oldSlugline = setSpelling(previousName)
  const outcome = await renameLocationRecord(scope, locationId, previousName, current, oldSlugline)
  if (outcome.status === 'taken') {
    const holder = records.find((entry) => entry.id === outcome.by)
    return {
      status: 'refused',
      message: `${oldSlugline} now resolves to ${holder?.name ?? 'another location'}. The rename cannot be undone from here - merge the two records instead.`,
    }
  }
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_LOCATION }

  const wanted = new Map(restores.map((entry) => [entry.id as NodeId, entry]))
  let skipped = 0
  const pending: HeadingNodeRewrite[] = []
  for (const episode of await listEpisodes(scope)) {
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    if (document === null) continue
    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) continue
    const before = read.value.map((entry) => entry.node)
    const here: HeadingNodeRewrite[] = []
    for (const node of before) {
      const entry = wanted.get(node.id)
      if (entry === undefined) continue
      wanted.delete(node.id)
      if (JSON.stringify(node.content) !== JSON.stringify(entry.after)) {
        skipped += 1
        continue
      }
      here.push({ id: node.id, content: entry.before })
    }
    if (here.length === 0) continue
    await snapshotVersion(scope, document.id, 'before_rename', before, before.length)
    pending.push(...here)
  }
  skipped += wanted.size
  const headings = await rewriteHeadingNodes(scope, pending)
  await requestRederive(scope)
  return { status: 'undone', headings, skipped }
}

export const parentProblem = (rawId: unknown, rawParent: unknown): Problem | null => {
  const id = parseId(rawId)
  const parent = ParentEditSchema.safeParse(rawParent ?? null)
  if (id === null || !parent.success) return { status: 'error', message: 'Pick a location to hang this one under.' }
  if (parent.data === id) return { status: 'error', message: 'A location cannot hang under itself.' }
  return null
}

/** Hang a record under another, or make it a primary set. The tree's one authored write. */
export const setParentWith = async (gate: ProjectGate, rawId: unknown, rawParent: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const problem = parentProblem(rawId, rawParent)
  if (problem !== null) return problem
  const id = parseId(rawId)
  const parent = ParentEditSchema.safeParse(rawParent ?? null)
  if (id === null || !parent.success) return { status: 'error', message: 'Pick a location to hang this one under.' }

  if (parent.data !== null) {
    const records = await listLocationRecords(gate.scope)
    if (wouldCycle(id, parent.data, records)) {
      return { status: 'refused', message: 'That would put a location inside one of its own sub-locations.' }
    }
  }
  const written = await setLocationParent(gate.scope, id, parent.data)
  if (!written) return { status: 'error', message: REFUSED_LOCATION }
  await requestRederive(gate.scope)
  return { status: 'saved' }
}

export const mergeProblem = (rawLoser: unknown, rawWinner: unknown): Problem | null => {
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  return loser === null || winner === null || loser === winner ? { status: 'error', message: 'Pick a different location to merge into.' } : null
}

export const mergeLocationsWith = async (gate: ProjectGate, rawLoser: unknown, rawWinner: unknown): Promise<MergeResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  if (loser === null || winner === null || loser === winner) return { status: 'error', message: 'Pick a different location to merge into.' }

  const before = (await listLocationRecords(gate.scope)).find((entry) => entry.id === loser)
  const merged = await mergeLocationRecords(gate.scope, loser, winner)
  if (!merged) return { status: 'error', message: REFUSED_LOCATION }
  // The loser's photo has no card to sit on any more. Best effort: a failed
  // delete leaves an orphan object, never a broken row.
  if (before?.photoKey !== undefined && before.photoKey !== null && storageAvailable()) await deleteObject(before.photoKey)
  await requestRederive(gate.scope)
  return { status: 'merged', into: winner }
}

export const locationIdProblem = (rawId: unknown): Problem | null => (parseId(rawId) === null ? { status: 'error', message: REFUSED_LOCATION } : null)

export const deleteLocationWith = async (gate: ProjectGate, rawId: unknown): Promise<DeleteResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_LOCATION }

  const before = (await listLocationRecords(gate.scope)).find((entry) => entry.id === id)
  const outcome = await deleteAbsentLocation(gate.scope, id)
  if (outcome === 'missing') return { status: 'error', message: REFUSED_LOCATION }
  if (outcome === 'present') {
    return {
      status: 'refused',
      message: 'This location is still in the script. Change its headings first, or merge the record into another.',
    }
  }
  if (before?.photoKey !== undefined && before.photoKey !== null && storageAvailable()) await deleteObject(before.photoKey)
  await requestRederive(gate.scope)
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

const QueueKeySchema = z.string().min(1).max(400)

const SluglineChoiceSchema = z.discriminatedUnion('kind', [
  /** Take the row's own proposal, whatever it points at. */
  z.object({ kind: z.literal('proposal') }),
  /** "Other…": bind to this record instead. */
  z.object({ kind: z.literal('location'), id: LocationIdSchema }),
  z.object({ kind: z.literal('new-record') }),
])

const StructureChoiceSchema = z.discriminatedUnion('kind', [
  /** Attach as proposed, creating the parent when the proposal names one. */
  z.object({ kind: z.literal('accept') }),
  /** Keep the record a primary set. The same guess is never made again. */
  z.object({ kind: z.literal('reject') }),
])

const isSluglineSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'slugline' }> =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'slugline'

const isStructureSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'structure' }> =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'structure'

const isTarget = (value: unknown): value is ProposalTarget =>
  typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

const pendingCount = async (scope: ProjectScope): Promise<number> =>
  (await listOpenLocationRows(scope)).filter((row) => row.subjectKind === 'slugline' && row.proposalTarget !== null).length

export const resolveSluglineProblem = (rawKey: unknown, rawChoice: unknown): Problem | null =>
  !QueueKeySchema.safeParse(rawKey).success || !SluglineChoiceSchema.safeParse(rawChoice).success ? { status: 'error', message: UNREADABLE_DECISION } : null

export const resolveSluglineWith = async (gate: ProjectGate, rawKey: unknown, rawChoice: unknown): Promise<ResolveResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const key = QueueKeySchema.safeParse(rawKey)
  const choice = SluglineChoiceSchema.safeParse(rawChoice)
  if (!key.success || !choice.success) return { status: 'error', message: UNREADABLE_DECISION }
  const { scope } = gate

  const row = (await listOpenLocationRows(scope)).find((entry) => entry.key === key.data)
  if (row === undefined || !isSluglineSubject(row.subject)) {
    return { status: 'error', message: 'That slugline is no longer in the queue. It may have been matched already.' }
  }
  const subject = row.subject
  const target: ProposalTarget | null = isTarget(row.proposalTarget) ? row.proposalTarget : null

  const chosen: ProposalTarget | null =
    choice.data.kind === 'proposal'
      ? target
      : choice.data.kind === 'location'
        ? { kind: 'location', id: choice.data.id }
        : { kind: 'new-record' }
  if (chosen === null) return { status: 'error', message: 'That slugline has no proposal to take. Pick a location, or make a new record.' }
  if (chosen.kind === 'location') {
    const outcome = await bindSlugline(scope, chosen.id, setSpelling(subject.slugline))
    if (outcome.status === 'taken') {
      return { status: 'refused', message: 'That set text already resolves to another location. Reload the queue.' }
    }
    if (outcome.status === 'missing') return { status: 'error', message: REFUSED_LOCATION }
  } else if (chosen.kind !== 'new-record') {
    return { status: 'error', message: 'A slugline can only be matched to a location or made a new one.' }
  }
  await recordResolveDecisions(scope, subject, [{ verdict: 'accepted', target: chosen }])

  const pass = await requestRederive(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  return { status: 'resolved', pending: await pendingCount(scope) }
}

export const resolveStructureProblem = (rawKey: unknown, rawChoice: unknown): Problem | null =>
  !QueueKeySchema.safeParse(rawKey).success || !StructureChoiceSchema.safeParse(rawChoice).success ? { status: 'error', message: UNREADABLE_DECISION } : null

/**
 * A structure proposal: hang this record under that one, or under a primary
 * set the headings imply but nobody has made. Accepting writes the edge - and,
 * for `new-parent`, mints the parent by hand first. Rejecting records the
 * decision; the pure core suppresses the same target on every later pass.
 */
export const resolveStructureWith = async (gate: ProjectGate, rawKey: unknown, rawChoice: unknown): Promise<ResolveResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const key = QueueKeySchema.safeParse(rawKey)
  const choice = StructureChoiceSchema.safeParse(rawChoice)
  if (!key.success || !choice.success) return { status: 'error', message: UNREADABLE_DECISION }
  const { scope } = gate

  const row = (await listOpenLocationRows(scope)).find((entry) => entry.key === key.data)
  if (row === undefined || !isStructureSubject(row.subject) || !isTarget(row.proposalTarget)) {
    return { status: 'error', message: 'That proposal is no longer in the queue.' }
  }
  const subject = row.subject
  const target = row.proposalTarget
  const child = parseId(subject.location)
  if (child === null) return { status: 'error', message: REFUSED_LOCATION }

  if (choice.data.kind === 'reject') {
    await recordResolveDecisions(scope, subject, [{ verdict: 'rejected', target }])
  } else {
    const records = await listLocationRecords(scope)
    let parent: LocationId | null = null
    if (target.kind === 'attach') {
      parent = target.parent
    } else if (target.kind === 'new-parent') {
      const nameKey = canonicalKey(target.name)
      const existing = records.find((entry) => canonicalKey(entry.name) === nameKey)
      if (existing !== undefined) parent = existing.id
      else {
        parent = await createLocationRecord(scope, target.name, null)
        await bindSlugline(scope, parent, setSpelling(target.name))
      }
    }
    if (parent === null) return { status: 'error', message: 'That proposal is not one the tree can take.' }
    if (parent === child || wouldCycle(child, parent, records)) {
      return { status: 'refused', message: 'That would put a location inside one of its own sub-locations.' }
    }
    const written = await setLocationParent(scope, child, parent)
    if (!written) return { status: 'error', message: REFUSED_LOCATION }
    await recordResolveDecisions(scope, subject, [{ verdict: 'accepted', target }])
  }

  const pass = await requestRederive(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  return { status: 'resolved', pending: await pendingCount(scope) }
}

const UndoSchema = z.discriminatedUnion('kind', [
  /** Undo on `This is X`: the acceptance goes and the set text is unbound from the record. */
  z.object({ kind: z.literal('bound'), id: LocationIdSchema }),
  /** Undo on `New location`: the acceptance goes and the minted record, still blank, with it. */
  z.object({ kind: z.literal('new-record') }),
  /** Undo on `Move it inside`: the acceptance goes, the record is a primary set again, a minted parent goes if blank. */
  z.object({ kind: z.literal('attached'), parent: LocationIdSchema }),
  /** Undo on `It's deliberate`: that rejection goes; the pass proposes the edge again. */
  z.object({ kind: z.literal('not-inside') }),
])

export const revokeProblem = (rawKey: unknown, rawUndo: unknown): Problem | null =>
  !QueueKeySchema.safeParse(rawKey).success || !UndoSchema.safeParse(rawUndo).success ? { status: 'error', message: UNREADABLE_DECISION } : null

/**
 * Take a queue decision back. The row may be `settled` by now (a bind settles
 * it); the key is the subject's, and the decisions are looked up by it, not
 * by an open row.
 */
export const revokeDecisionWith = async (gate: ProjectGate, rawKey: unknown, rawUndo: unknown): Promise<ResolveResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const parsedKey = QueueKeySchema.safeParse(rawKey)
  const parsedUndo = UndoSchema.safeParse(rawUndo)
  if (!parsedKey.success || !parsedUndo.success) return { status: 'error', message: UNREADABLE_DECISION }
  const key = parsedKey.data
  const undo = parsedUndo.data
  const { scope } = gate

  const decisions = (await listResolveDecisions(scope)).filter((decision) => decision.rowKey === key)
  if (decisions.length === 0) return { status: 'error', message: 'There is nothing to take back on that heading.' }

  if (undo.kind === 'bound') {
    if (!key.startsWith('slugline:')) return { status: 'error', message: UNREADABLE_DECISION }
    const setKey = key.slice('slugline:'.length)
    const id = undo.id
    const held = (await listBoundSluglines(scope)).find((entry) => entry.locationId === id && canonicalKey(entry.slugline) === setKey)
    if (held === undefined) return { status: 'error', message: 'That set text is no longer bound here.' }
    const outcome = await unbindSlugline(scope, id, held.slugline)
    if (outcome === 'last') {
      return { status: 'refused', message: 'That is the only set text bound to this record. Rename the record, or merge it, instead.' }
    }
    await deleteResolveDecisions(scope, key, [proposalTargetKey({ kind: 'location', id })])
  } else if (undo.kind === 'new-record') {
    if (!key.startsWith('slugline:')) return { status: 'error', message: UNREADABLE_DECISION }
    await deleteResolveDecisions(scope, key, [proposalTargetKey({ kind: 'new-record' })])
    const setKey = key.slice('slugline:'.length)
    const holder = (await listBoundSluglines(scope)).find((entry) => canonicalKey(entry.slugline) === setKey)
    if (holder !== undefined) {
      const gone = await deleteBlankLocation(scope, holder.locationId)
      // A record the writer has already written on is kept; only its
      // binding goes, so the heading proposes it rather than resolving to it.
      if (gone === 'kept') await unbindSlugline(scope, holder.locationId, holder.slugline)
    }
  } else if (undo.kind === 'attached') {
    if (!key.startsWith('structure:')) return { status: 'error', message: UNREADABLE_DECISION }
    const child = parseId(key.slice('structure:'.length))
    if (child === null) return { status: 'error', message: REFUSED_LOCATION }
    await deleteResolveDecisions(scope, key, null)
    await setLocationParent(scope, child, null)
    // A parent the accept minted, untouched since, goes with it; one the
    // writer has written on, or one that was already there, stays.
    await deleteBlankLocation(scope, undo.parent)
  } else {
    await deleteResolveDecisions(scope, key, null)
  }

  const pass = await requestRederive(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  return { status: 'resolved', pending: await pendingCount(scope) }
}
