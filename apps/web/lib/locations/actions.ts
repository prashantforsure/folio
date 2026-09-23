'use server'

import { InlineContentSchema, LOCATION_PHOTO_MAX_BYTES, LocationEditSchema, LocationIdSchema, ParentEditSchema, TitleSchema } from '@folio/contracts'
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
  moveBoundSlugline,
  proposalTargetKey,
  readDocumentByKind,
  readScreenplayNodes,
  recordDecisionByKey,
  recordResolveDecisions,
  renameLocationRecord,
  rewriteHeadingNodes,
  setLocationParent,
  setLocationPhotoKey,
  snapshotVersion,
  unbindSlugline,
  updateLocationRecord,
} from '@folio/db'
import type { HeadingNodeRewrite, ProjectScope } from '@folio/db'
import type { LocationId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey, readSlugline, renameLocationHeadings, setSpelling } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import { isRefusal, openProject } from '../script/gate'
import { requestRederive } from '../script/derive-batch'
import { rederiveProject } from '../script/server'
import { readImage, IMAGE_EXTENSION } from '../storage/image'
import { deleteObject, publicUrl, putObject, storageAvailable } from '../storage/r2'
import { wouldCycle } from './figures'
import type {
  BindResult,
  CreateResult,
  DeleteResult,
  DeriveResult,
  HeadingRestore,
  MergeResult,
  MoveResult,
  PhotoResult,
  RenameDone,
  RenamePreview,
  ResolveResult,
  SavedResult,
  UndoRenameResult,
} from './result'
import { similarKey } from './server'

/**
 * The Locations route's writes.
 *
 * Every one goes gate -> repository -> (pipeline) -> result, through the
 * project-scoped gate in `lib/script/gate.ts`, as the Characters route's
 * do, with the capability each write needs beside it (ADR 0003 D2,
 * `lib/auth/roles.ts`): a reader may take the rename preview and nothing
 * else on this route.
 *
 * ## Which writes re-derive, and which do not
 *
 * A description, an address, a status, a photo: authored data on the
 * record, and nothing about the script or the tree changed, so nothing is
 * re-derived.
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
 * back as the diff - with every heading's two readings, so `undoRename` can
 * put back exactly the headings nothing has touched since (the one step).
 * `previewRename` is the same reading with nothing written, for the confirm.
 *
 * ## Decisions can be taken back
 *
 * A queue decision is rows (`resolve_decisions`) and the insert is
 * idempotent on the row and its target, so `revokeDecision` deletes exactly
 * the rows a decision wrote, undoes what it bound, minted or hung, and
 * re-derives - the status bar's eight-second `Undo`. "Two records are
 * different places" (`decideSimilar`) is a decision on a key no pass ever
 * writes (`set:<a>:<b>`), so the finding stays gone without touching the
 * queue.
 *
 * ## A photo goes through the action, not past it
 *
 * The portrait's pattern (`lib/characters/actions.ts`): the **gate runs
 * first**, because reading the body buffers the whole upload into memory
 * and a stranger must not be able to make this process do that; then the
 * file arrives as `FormData`, is read as an image by its bytes
 * (`lib/storage/image.ts`), is put under `projects/<id>/locations/<id>/`,
 * and only then does the row point at it; the old object is deleted after
 * the row says so. No signed upload URL: the client never talks to the
 * bucket.
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
  rawKey: unknown = null,
): Promise<CreateResult> => {
  const name = TitleSchema.safeParse(rawName)
  const parent = ParentEditSchema.safeParse(rawParent ?? null)
  if (!name.success || !parent.success) return { status: 'error', message: 'A location needs a name, up to 200 characters.' }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  const id = await createLocationRecord(gate.scope, name.data, parent.data, key.key)
  // The name's set text binds to the new record, so a heading typed later
  // resolves to it rather than proposing. A set somebody else already holds
  // is left with them; the writer sees it in the queue.
  await bindSlugline(gate.scope, id, setSpelling(name.data))
  await requestRederive(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

export const saveLocation = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const edit = LocationEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That edit could not be read.' }
  const gate = await openProject(projectId, ROLE.authoredEdit)
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
export const renameLocation = async (projectId: string, rawId: string, rawName: string): Promise<RenameDone> => {
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: 'A location needs a name, up to 200 characters.' }
  const gate = await openProject(projectId, ROLE.entityOperation)
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
  revalidatePath(workspacePath(project.id), 'layout')
  return {
    status: 'renamed',
    headings,
    episodes: episodesTouched,
    undo: { locationId: id, previousName: record.name, name: name.data, restores },
  }
}

/**
 * What a rename would do, before it does: the headings per episode the
 * write-back would rewrite, the bound set texts it leaves alone, and
 * whether the new set text is already another record's. A pure read.
 */
export const previewRename = async (projectId: string, rawId: string, rawName: string): Promise<RenamePreview> => {
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: 'A location needs a name, up to 200 characters.' }
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
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

/**
 * Take a rename back: the record's old name and set text, then every
 * heading the rename rewrote whose content is still exactly what the rename
 * left - a heading edited since is left as it is and counted as skipped.
 * A `before_rename` version is taken of each document, so the undo is as
 * recoverable as the rename was.
 */
export const undoRename = async (projectId: string, rawUndo: unknown): Promise<UndoRenameResult> => {
  const undo = UndoRenameSchema.safeParse(rawUndo)
  if (!undo.success) return { status: 'error', message: 'That rename could not be taken back.' }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate
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
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'undone', headings, skipped }
}

/** Hang a record under another, or make it a primary set. The tree's one authored write. */
export const setParent = async (projectId: string, rawId: string, rawParent: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const parent = ParentEditSchema.safeParse(rawParent ?? null)
  if (id === null || !parent.success) return { status: 'error', message: 'Pick a location to hang this one under.' }
  if (parent.data === id) return { status: 'error', message: 'A location cannot hang under itself.' }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  if (parent.data !== null) {
    const records = await listLocationRecords(gate.scope)
    if (wouldCycle(id, parent.data, records)) {
      return { status: 'refused', message: 'That would put a location inside one of its own sub-locations.' }
    }
  }
  const written = await setLocationParent(gate.scope, id, parent.data)
  if (!written) return { status: 'error', message: REFUSED_LOCATION }
  await requestRederive(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const mergeLocations = async (projectId: string, rawLoser: string, rawWinner: string): Promise<MergeResult> => {
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  if (loser === null || winner === null || loser === winner) {
    return { status: 'error', message: 'Pick a different location to merge into.' }
  }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  const before = (await listLocationRecords(gate.scope)).find((entry) => entry.id === loser)
  const merged = await mergeLocationRecords(gate.scope, loser, winner)
  if (!merged) return { status: 'error', message: REFUSED_LOCATION }
  // The loser's photo has no card to sit on any more. Best effort: a failed
  // delete leaves an orphan object, never a broken row.
  if (before?.photoKey !== undefined && before.photoKey !== null && storageAvailable()) await deleteObject(before.photoKey)
  await requestRederive(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'merged', into: winner }
}

export const deleteLocation = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_LOCATION }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

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
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// The photo
// ---------------------------------------------------------------------------

/**
 * Store a photo for a record. The file is the `photo` entry of the form
 * data. See the header for the order of operations.
 */
export const uploadLocationPhoto = async (projectId: string, rawId: string, form: FormData): Promise<PhotoResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_LOCATION }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  if (!storageAvailable()) return { status: 'refused', message: 'Photo storage is not set up on this server yet.' }
  const image = await readImage(form.get('photo'), LOCATION_PHOTO_MAX_BYTES, 'photo')
  if (!image.ok) return { status: image.status, message: image.message }

  const key = `projects/${gate.project.id}/locations/${id}/photo-${crypto.randomUUID()}.${IMAGE_EXTENSION[image.type]}`
  const put = await putObject(key, image.bytes, image.type)
  if (!put.ok) return { status: 'error', message: put.message }
  const pointed = await setLocationPhotoKey(gate.scope, id, key)
  if (!pointed.found) {
    await deleteObject(key)
    return { status: 'error', message: REFUSED_LOCATION }
  }
  if (pointed.previous !== null && pointed.previous !== key) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: publicUrl(key) }
}

export const removeLocationPhoto = async (projectId: string, rawId: string): Promise<PhotoResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_LOCATION }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const pointed = await setLocationPhotoKey(gate.scope, id, null)
  if (!pointed.found) return { status: 'error', message: REFUSED_LOCATION }
  if (pointed.previous !== null && storageAvailable()) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: null }
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
  const gate = await openProject(projectId, ROLE.entityOperation)
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
  if (outcome.status === 'bound') await requestRederive(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'bound' }
}

export const unbindSluglineAlias = async (projectId: string, rawId: string, rawSlugline: string): Promise<SavedResult> => {
  const id = parseId(rawId)
  const slugline = SluglineSchema.safeParse(rawSlugline)
  if (id === null || !slugline.success) return { status: 'error', message: REFUSED_LOCATION }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  const outcome = await unbindSlugline(gate.scope, id, slugline.data)
  if (outcome === 'missing') return { status: 'error', message: 'That set text is not bound here.' }
  if (outcome === 'last') {
    return { status: 'refused', message: 'That is the only set text bound to this record. Rename the record, or merge it, instead.' }
  }
  await requestRederive(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/**
 * Move a set text to this record from whichever holds it - the alias
 * table's `Move it here` when a bind was refused as taken. One statement
 * in the repository; the holder keeps its last set text.
 */
export const moveAlias = async (projectId: string, rawId: string, rawSlugline: string): Promise<MoveResult> => {
  const id = parseId(rawId)
  const slugline = SluglineSchema.safeParse(rawSlugline)
  if (id === null || !slugline.success) return { status: 'error', message: 'An alias is a set text, up to 200 characters.' }
  const set = setTextOf(slugline.data)
  if (canonicalKey(set) === '') return { status: 'error', message: 'An alias needs at least one letter or digit.' }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  const outcome = await moveBoundSlugline(gate.scope, set, id)
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_LOCATION }
  if (outcome.status === 'last') {
    const holder = (await listLocationRecords(gate.scope)).find((entry) => entry.id === outcome.by)
    return {
      status: 'refused',
      message: `${set} is the only set text bound to ${holder?.name ?? 'the other location'}. Merge the two records instead.`,
    }
  }
  if (outcome.status === 'already') return { status: 'moved', from: null }
  await requestRederive(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'moved', from: outcome.from }
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
  const gate = await openProject(projectId, ROLE.entityOperation)
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

  const pass = await requestRederive(scope)
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
  const gate = await openProject(projectId, ROLE.entityOperation)
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

  const pass = await requestRederive(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(project.id), 'layout')
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

/**
 * Take a queue decision back. See the header. The row may be `settled` by
 * now (a bind settles it); the key is the subject's, and the decisions are
 * looked up by it, not by an open row.
 */
export const revokeDecision = async (projectId: string, rawKey: string, rawUndo: unknown): Promise<ResolveResult> => {
  const key = z.string().min(1).max(400).safeParse(rawKey)
  const undo = UndoSchema.safeParse(rawUndo)
  if (!key.success || !undo.success) return { status: 'error', message: 'That decision could not be read.' }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const decisions = (await listResolveDecisions(scope)).filter((decision) => decision.rowKey === key.data)
  if (decisions.length === 0) return { status: 'error', message: 'There is nothing to take back on that heading.' }

  if (undo.data.kind === 'bound') {
    if (!key.data.startsWith('slugline:')) return { status: 'error', message: 'That decision could not be read.' }
    const setKey = key.data.slice('slugline:'.length)
    const id = undo.data.id
    const held = (await listBoundSluglines(scope)).find((entry) => entry.locationId === id && canonicalKey(entry.slugline) === setKey)
    if (held === undefined) return { status: 'error', message: 'That set text is no longer bound here.' }
    const outcome = await unbindSlugline(scope, id, held.slugline)
    if (outcome === 'last') {
      return { status: 'refused', message: 'That is the only set text bound to this record. Rename the record, or merge it, instead.' }
    }
    await deleteResolveDecisions(scope, key.data, [proposalTargetKey({ kind: 'location', id })])
  } else if (undo.data.kind === 'new-record') {
    if (!key.data.startsWith('slugline:')) return { status: 'error', message: 'That decision could not be read.' }
    await deleteResolveDecisions(scope, key.data, [proposalTargetKey({ kind: 'new-record' })])
    const setKey = key.data.slice('slugline:'.length)
    const holder = (await listBoundSluglines(scope)).find((entry) => canonicalKey(entry.slugline) === setKey)
    if (holder !== undefined) {
      const gone = await deleteBlankLocation(scope, holder.locationId)
      // A record the writer has already written on is kept; only its
      // binding goes, so the heading proposes it rather than resolving to it.
      if (gone === 'kept') await unbindSlugline(scope, holder.locationId, holder.slugline)
    }
  } else if (undo.data.kind === 'attached') {
    if (!key.data.startsWith('structure:')) return { status: 'error', message: 'That decision could not be read.' }
    const child = parseId(key.data.slice('structure:'.length))
    if (child === null) return { status: 'error', message: REFUSED_LOCATION }
    await deleteResolveDecisions(scope, key.data, null)
    await setLocationParent(scope, child, null)
    // A parent the accept minted, untouched since, goes with it; one the
    // writer has written on, or one that was already there, stays.
    await deleteBlankLocation(scope, undo.data.parent)
  } else {
    await deleteResolveDecisions(scope, key.data, null)
  }

  const pass = await requestRederive(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'resolved', pending: await pendingCount(scope) }
}

const SimilarChoiceSchema = z.discriminatedUnion('kind', [
  /** The two are one place: merge this record into the other. */
  z.object({ kind: z.literal('merge'), into: LocationIdSchema }),
  /** They are different places; the finding is never shown for this pair again. */
  z.object({ kind: z.literal('differ'), other: LocationIdSchema }),
])

/**
 * The `Same place?` finding's two doors: merge (the domain operation,
 * through `mergeLocations`), or "they're different" - a decision under a
 * `set:<a>:<b>` key that no pass writes, so the loader hides the pair from
 * now on. Nothing about the script changes either way.
 */
export const decideSimilar = async (projectId: string, rawId: string, rawChoice: unknown): Promise<MergeResult | SavedResult> => {
  const id = parseId(rawId)
  const choice = SimilarChoiceSchema.safeParse(rawChoice)
  if (id === null || !choice.success) return { status: 'error', message: 'That decision could not be read.' }
  if (choice.data.kind === 'merge') return mergeLocations(projectId, id, choice.data.into)
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  await recordDecisionByKey(gate.scope, similarKey(id, choice.data.other), 'rejected', { kind: 'location', id: choice.data.other })
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/** The empty state's "Derive N locations": a pass, awaited, project-wide. */
export const deriveLocationsNow = async (projectId: string): Promise<DeriveResult> => {
  const gate = await openProject(projectId, ROLE.derive)
  if (isRefusal(gate)) return gate
  const pass = await rederiveProject(gate.scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return {
    status: 'derived',
    locations: pass.derivation.entities.locations.filter((record) => record.presence === 'present').length,
  }
}
