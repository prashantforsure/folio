'use server'

import type { TextExportResult } from '../workspace/export'
import { locationBreakdownCsv, locationsCsv } from './server'

import { LOCATION_PHOTO_MAX_BYTES, LocationIdSchema } from '@folio/contracts'
import {
  bindSlugline,
  listEpisodes,
  listLocationRecords,
  moveBoundSlugline,
  recordDecisionByKey,
  setLocationPhotoKey,
  unbindSlugline,
} from '@folio/db'
import type { LocationId } from '@folio/script'
import { canonicalKey, readSlugline, setSpelling } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import { isRefusal, openProject } from '../script/gate'
import { requestRederive } from '../script/derive-batch'
import { rederiveProject } from '../script/server'
import { readImage, IMAGE_EXTENSION } from '../storage/image'
import { deleteObject, publicUrl, putObject, storageAvailable } from '../storage/r2'
import {
  createLocationProblem,
  createLocationWith,
  deleteLocationWith,
  locationEditProblem,
  locationIdProblem,
  mergeLocationsWith,
  mergeProblem,
  parentProblem,
  previewRenameWith,
  renameLocationWith,
  renameProblem,
  resolveSluglineProblem,
  resolveSluglineWith,
  resolveStructureProblem,
  resolveStructureWith,
  revokeDecisionWith,
  revokeProblem,
  saveLocationWith,
  setParentWith,
  undoRenameProblem,
  undoRenameWith,
} from './core'
import type {
  BindResult,
  CreateResult,
  DeleteResult,
  DeriveResult,
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
 * ## Thin actions over core functions (roadmap task 4.2)
 *
 * Every write the agent's tools reach is a core function in `core.ts` that
 * takes a gate and the raw input; the action here parses what it always parsed
 * before the gate, opens the cookie gate, calls the core and revalidates on
 * the outcome it always did. The photo, the alias table, `decideSimilar`, the
 * derive button and the exports are as they were.
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
  const problem = createLocationProblem(rawName, rawParent, rawKey)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await createLocationWith(gate, rawName, rawParent, rawKey)
  if (result.status === 'created') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

export const saveLocation = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const problem = locationEditProblem(rawId, rawEdit)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await saveLocationWith(gate, rawId, rawEdit)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** The record-level rename (`renameLocationWith`). See the header. */
export const renameLocation = async (projectId: string, rawId: string, rawName: string): Promise<RenameDone> => {
  const problem = renameProblem(rawId, rawName)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await renameLocationWith(gate, rawId, rawName)
  if (result.status === 'renamed') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** What a rename would do, before it does (`previewRenameWith`). A pure read. */
export const previewRename = async (projectId: string, rawId: string, rawName: string): Promise<RenamePreview> => {
  const problem = renameProblem(rawId, rawName)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  return previewRenameWith(gate, rawId, rawName)
}

/** Take a rename back (`undoRenameWith`): a heading edited since is left as it is and counted as skipped. */
export const undoRename = async (projectId: string, rawUndo: unknown): Promise<UndoRenameResult> => {
  const problem = undoRenameProblem(rawUndo)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await undoRenameWith(gate, rawUndo)
  if (result.status === 'undone') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** Hang a record under another, or make it a primary set. The tree's one authored write. */
export const setParent = async (projectId: string, rawId: string, rawParent: unknown): Promise<SavedResult> => {
  const problem = parentProblem(rawId, rawParent)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await setParentWith(gate, rawId, rawParent)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

export const mergeLocations = async (projectId: string, rawLoser: string, rawWinner: string): Promise<MergeResult> => {
  const problem = mergeProblem(rawLoser, rawWinner)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await mergeLocationsWith(gate, rawLoser, rawWinner)
  if (result.status === 'merged') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

export const deleteLocation = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const problem = locationIdProblem(rawId)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await deleteLocationWith(gate, rawId)
  if (result.status === 'deleted') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
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

export const resolveSlugline = async (projectId: string, rawKey: string, rawChoice: unknown): Promise<ResolveResult> => {
  const problem = resolveSluglineProblem(rawKey, rawChoice)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await resolveSluglineWith(gate, rawKey, rawChoice)
  if (result.status === 'resolved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/**
 * A structure proposal (`resolveStructureWith`): hang this record under that
 * one, or under a primary set the headings imply but nobody has made.
 * Rejecting records the decision; the pure core suppresses the same target on
 * every later pass.
 */
export const resolveStructure = async (projectId: string, rawKey: string, rawChoice: unknown): Promise<ResolveResult> => {
  const problem = resolveStructureProblem(rawKey, rawChoice)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await resolveStructureWith(gate, rawKey, rawChoice)
  if (result.status === 'resolved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** Take a queue decision back (`revokeDecisionWith`). See the header. */
export const revokeDecision = async (projectId: string, rawKey: string, rawUndo: unknown): Promise<ResolveResult> => {
  const problem = revokeProblem(rawKey, rawUndo)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await revokeDecisionWith(gate, rawKey, rawUndo)
  if (result.status === 'resolved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
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

// ---------------------------------------------------------------------------
// Export (roadmap task 2.4)
// ---------------------------------------------------------------------------

/** The Sheet view's CSV - the series, or one episode by its ordinal - for the requesting user (`ROLE.export`). */
export const exportLocationsCsv = async (projectId: string, rawOrdinal: unknown): Promise<TextExportResult> => {
  const ordinal = z.number().int().min(1).nullable().safeParse(rawOrdinal ?? null)
  if (!ordinal.success) return { status: 'error', message: 'That episode could not be read.' }
  const gate = await openProject(projectId, ROLE.export)
  if (isRefusal(gate)) return gate
  const episodes = await listEpisodes(gate.scope)
  if (ordinal.data !== null && !episodes.some((episode) => episode.ordinal === ordinal.data)) return { status: 'error', message: 'There is no such episode.' }
  return { status: 'exported', ...(await locationsCsv({ scope: gate.scope, project: gate.project, episodes }, ordinal.data)) }
}

/** One set's scene breakdown as CSV, for the requesting user (`ROLE.export`). */
export const exportLocationBreakdown = async (projectId: string, rawId: unknown): Promise<TextExportResult> => {
  const id = LocationIdSchema.safeParse(rawId)
  if (!id.success) return { status: 'error', message: 'That location could not be found.' }
  const gate = await openProject(projectId, ROLE.export)
  if (isRefusal(gate)) return gate
  const csv = await locationBreakdownCsv({ scope: gate.scope, project: gate.project, episodes: await listEpisodes(gate.scope) }, id.data)
  return csv === null ? { status: 'error', message: 'That location could not be found.' } : { status: 'exported', ...csv }
}
