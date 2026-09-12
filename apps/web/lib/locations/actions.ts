'use server'

import { ArcNoteEditSchema, LocationEditSchema, LocationIdSchema, ParentEditSchema, TitleSchema } from '@folio/contracts'
import {
  bindSlugline,
  createLocationRecord,
  deleteAbsentLocation,
  listBoundSluglines,
  listEpisodes,
  listLocationRecords,
  listOpenLocationRows,
  mergeLocationRecords,
  readDocumentByKind,
  readScreenplayNodes,
  recordResolveDecisions,
  renameLocationRecord,
  rewriteHeadingNodes,
  setLocationParent,
  snapshotVersion,
  unbindSlugline,
  updateLocationRecord,
  writeLocationArcNote,
} from '@folio/db'
import type { HeadingNodeRewrite, ProjectScope } from '@folio/db'
import type { LocationId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey, readSlugline, renameLocationHeadings, setSpelling } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openProject } from '../script/gate'
import { rederiveProject } from '../script/server'
import { wouldCycle } from './figures'
import type {
  BindResult,
  CreateResult,
  DeleteResult,
  DeriveResult,
  MergeResult,
  RenameResult,
  ResolveResult,
  SavedResult,
} from './result'

/**
 * The Locations route's writes.
 *
 * Every one goes gate -> repository -> (pipeline) -> result, through the
 * project-scoped gate in `lib/script/gate.ts`, as the Characters route's
 * do. Membership, not role; flagged again.
 *
 * ## Which writes re-derive, and which do not
 *
 * A description, an arc note: authored data on the record, and nothing
 * about the script or the tree changed, so nothing is re-derived.
 *
 * Binding a set text, a queue decision, a merge, a rename, **and the tree
 * edge**: each changes what the next pass resolves or rolls up - a parent
 * set's counts are its subtree's - so each awaits a project-wide re-derive
 * before answering, because what the writer sees next is that pass's
 * output.
 *
 * ## The rename is the second sanctioned write-back
 *
 * AGENTS.md, "Derivation is one-way - except": a location record rename
 * "rewrites every scene heading that uses it" - "explicit, diffed, undoable
 * in one step". `renameLocation` is that operation and nothing else here
 * writes a node: the pure core's `renameLocationHeadings` decides which
 * headings change, a `before_rename` version is taken of every document it
 * touches, the headings are rewritten in one statement, and the count comes
 * back as the diff.
 *
 * ## The tree is written here, by a person
 *
 * `setParent` and the structure decisions in `resolveStructure` are the
 * only writers of `locations.parent_id`. A cycle is refused before the
 * write, from the rows in hand (`wouldCycle`); the pure core would report
 * one as data, but a writer asking for one is a mistake worth refusing.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const REFUSED_LOCATION = 'That location could not be found.'

const parseId = (raw: unknown): LocationId | null => {
  const parsed = LocationIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

/** A set text as the writer typed it: a whole heading is read down to its set, a bare set is spelled. */
const setTextOf = (raw: string): string => {
  const reading = readSlugline(raw)
  return setSpelling(reading.ok ? reading.value.set : raw)
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export const createLocation = async (
  projectId: string,
  rawName: string,
  rawParent: unknown = null,
): Promise<CreateResult> => {
  const name = TitleSchema.safeParse(rawName)
  const parent = ParentEditSchema.safeParse(rawParent ?? null)
  if (!name.success || !parent.success) return { status: 'error', message: 'A location needs a name, up to 200 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const id = await createLocationRecord(gate.scope, name.data, parent.data)
  // The name's set text binds to the new record, so a heading typed later
  // resolves to it rather than proposing. A set somebody else already holds
  // is left with them; the writer sees it in the queue.
  await bindSlugline(gate.scope, id, setSpelling(name.data))
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

export const saveLocation = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const edit = LocationEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That edit could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await updateLocationRecord(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_LOCATION }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/**
 * The record-level rename. See the header.
 *
 * The old name's bound set texts are the ones whose canonical key is the
 * old name's; they are swapped for the new spelling in the alias table
 * (`renameLocationRecord`), and the headings carrying the old set are
 * rewritten in every episode. Aliases the writer bound stay bound.
 */
export const renameLocation = async (projectId: string, rawId: string, rawName: string): Promise<RenameResult> => {
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: 'A location needs a name, up to 200 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

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
    return {
      status: 'refused',
      message: `${newSlugline} already resolves to ${holder?.name ?? 'another location'}. Merge the two records instead.`,
    }
  }
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_LOCATION }

  // The rewrite, episode by episode: a `before_rename` version of every
  // script that changes, then every changed heading in one statement.
  let episodesTouched = 0
  const pending: HeadingNodeRewrite[] = []
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
    for (const node of result.nodes) if (changed.has(node.id)) pending.push({ id: node.id, content: node.content })
  }
  const headings = await rewriteHeadingNodes(scope, pending)
  await rederiveProject(scope)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'renamed', headings, episodes: episodesTouched }
}

/** Hang a record under another, or make it a primary set. The tree's one authored write. */
export const setParent = async (projectId: string, rawId: string, rawParent: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const parent = ParentEditSchema.safeParse(rawParent ?? null)
  if (id === null || !parent.success) return { status: 'error', message: 'Pick a location to hang this one under.' }
  if (parent.data === id) return { status: 'error', message: 'A location cannot hang under itself.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  if (parent.data !== null) {
    const records = await listLocationRecords(gate.scope)
    if (wouldCycle(id, parent.data, records)) {
      return { status: 'refused', message: 'That would put a location inside one of its own sub-locations.' }
    }
  }
  const written = await setLocationParent(gate.scope, id, parent.data)
  if (!written) return { status: 'error', message: REFUSED_LOCATION }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const mergeLocations = async (projectId: string, rawLoser: string, rawWinner: string): Promise<MergeResult> => {
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  if (loser === null || winner === null || loser === winner) {
    return { status: 'error', message: 'Pick a different location to merge into.' }
  }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const merged = await mergeLocationRecords(gate.scope, loser, winner)
  if (!merged) return { status: 'error', message: REFUSED_LOCATION }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'merged', into: winner }
}

export const deleteLocation = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_LOCATION }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await deleteAbsentLocation(gate.scope, id)
  if (outcome === 'missing') return { status: 'error', message: REFUSED_LOCATION }
  if (outcome === 'present') {
    return {
      status: 'refused',
      message: 'This location is still in the script. Change its headings first, or merge the record into another.',
    }
  }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// The alias table
// ---------------------------------------------------------------------------

const SluglineSchema = z.string().trim().min(1).max(200)

export const bindSluglineAlias = async (projectId: string, rawId: string, rawSlugline: string): Promise<BindResult> => {
  const id = parseId(rawId)
  const slugline = SluglineSchema.safeParse(rawSlugline)
  if (id === null || !slugline.success) return { status: 'error', message: 'An alias is a set text, up to 200 characters.' }
  const set = setTextOf(slugline.data)
  if (canonicalKey(set) === '') return { status: 'error', message: 'An alias needs at least one letter or digit.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await bindSlugline(gate.scope, id, set)
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_LOCATION }
  if (outcome.status === 'taken') {
    const records = await listLocationRecords(gate.scope)
    const holder = records.find((entry) => entry.id === outcome.by)
    return {
      status: 'refused',
      message: `${set} already resolves to ${holder?.name ?? 'another location'}. Unbind it there first, or merge.`,
    }
  }
  if (outcome.status === 'bound') await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'bound' }
}

export const unbindSluglineAlias = async (projectId: string, rawId: string, rawSlugline: string): Promise<SavedResult> => {
  const id = parseId(rawId)
  const slugline = SluglineSchema.safeParse(rawSlugline)
  if (id === null || !slugline.success) return { status: 'error', message: REFUSED_LOCATION }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await unbindSlugline(gate.scope, id, slugline.data)
  if (outcome === 'missing') return { status: 'error', message: 'That set text is not bound here.' }
  if (outcome === 'last') {
    return { status: 'refused', message: 'That is the only set text bound to this record. Rename the record, or merge it, instead.' }
  }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// Arc notes
// ---------------------------------------------------------------------------

export const saveArcNote = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const edit = ArcNoteEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'A note is a line of text, up to 2000 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await writeLocationArcNote(gate.scope, id, edit.data.episodeId, edit.data.text)
  if (!written) return { status: 'error', message: REFUSED_LOCATION }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

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

export const resolveSlugline = async (projectId: string, rawKey: string, rawChoice: unknown): Promise<ResolveResult> => {
  const key = z.string().min(1).max(400).safeParse(rawKey)
  const choice = SluglineChoiceSchema.safeParse(rawChoice)
  if (!key.success || !choice.success) return { status: 'error', message: 'That decision could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

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

  const pass = await rederiveProject(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'resolved', pending: await pendingCount(scope) }
}

/**
 * A structure proposal: hang this record under that one, or under a
 * primary set the headings imply but nobody has made. Accepting writes the
 * edge - and, for `new-parent`, mints the parent by hand first, its name
 * bound as its set text, unless a live record already carries that name.
 * Rejecting records the decision; the pure core suppresses the same target
 * on every later pass.
 */
export const resolveStructure = async (projectId: string, rawKey: string, rawChoice: unknown): Promise<ResolveResult> => {
  const key = z.string().min(1).max(400).safeParse(rawKey)
  const choice = StructureChoiceSchema.safeParse(rawChoice)
  if (!key.success || !choice.success) return { status: 'error', message: 'That decision could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

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

  const pass = await rederiveProject(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'resolved', pending: await pendingCount(scope) }
}

/** The empty state's "Derive N locations": a pass, awaited, project-wide. */
export const deriveLocationsNow = async (projectId: string): Promise<DeriveResult> => {
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const pass = await rederiveProject(gate.scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return {
    status: 'derived',
    locations: pass.derivation.entities.locations.filter((record) => record.presence === 'present').length,
  }
}
