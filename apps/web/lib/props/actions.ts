'use server'

import { PROP_PHOTO_MAX_BYTES, PropAliasSchema, PropIdSchema } from '@folio/contracts'
import { bindPropAlias, setPropPhotoKey, unbindPropAlias } from '@folio/db'
import type { PropId } from '@folio/script'
import { revalidatePath } from 'next/cache'

import { ROLE } from '../auth/roles'
import { isRefusal, openProject } from '../script/gate'
import { IMAGE_EXTENSION, readImage } from '../storage/image'
import { deleteObject, publicUrl, putObject, storageAvailable } from '../storage/r2'
import { createPropProblem, createPropWith, deletePropWith, mergePropProblem, mergePropsWith, propEditProblem, propIdProblem, renamePropProblem, renamePropWith, savePropWith } from './core'
import type { BindResult, CreateResult, DeleteResult, MergeResult, PhotoResult, SavedResult } from './result'
import { REFUSED_PROP } from './result'

/**
 * The Props route's writes.
 *
 * Every one goes Zod parse -> gate -> repository -> revalidate -> result,
 * through the project-scoped gate in `lib/script/gate.ts`, as the
 * Characters and Locations routes' do, and every write here is a writer's
 * (ADR 0003 D2): `ROLE.entityOperation` for the record and its aliases,
 * `ROLE.authoredEdit` for a field or a photo.
 *
 * ## Thin actions over core functions (roadmap task 4.2)
 *
 * The five record writes the agent reaches are core functions in `core.ts`
 * taking a gate and the raw input; each action here parses what it always
 * parsed before the gate, opens the cookie gate, calls the core and
 * revalidates on the outcome it always did. The photo and the alias table
 * are as they were.
 *
 * ## Nothing here re-derives, and that is the point
 *
 * The Locations actions re-derive after a bind, a merge or a rename,
 * because each changes what the next pass resolves. A prop has no
 * derivation pass at all (`packages/db`, `schema/props.ts`): the evidence
 * is read at request time from the node list, so the next render already
 * reflects a new alias. `revalidatePath` is the whole refresh.
 *
 * ## A rename is not a write-back
 *
 * AGENTS.md's exception table sanctions exactly two write-backs into the
 * document - a character rename and a location rename - and says "there is
 * no third case. Escalate". A prop rename is not a third case: a prop's
 * name is written nowhere the app owns, so there is nothing in the script
 * to rewrite. `renameProp` changes the record and swaps the alias that
 * *was* the old name for the new spelling, and touches no node. (Ruling 6
 * names this too.)
 *
 * ## A photo goes through the action, not past it
 *
 * `lib/characters/actions.ts`'s ordering verbatim, which the Locations
 * route also copies: the **gate first** - nothing reads the body on behalf
 * of somebody who is not a member - then `storageAvailable()`, then the
 * byte cap, then the MIME sniffed **from the bytes** rather than trusted
 * from the form, then `putObject`, then the row is pointed at the new key -
 * and only then is the old object deleted. Nothing is deleted before the row says the
 * new one is the photo, so a failure leaves an orphan rather than a record
 * with no picture. No signed upload URL: the client never talks to the
 * bucket.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const parseId = (raw: unknown): PropId | null => {
  const parsed = PropIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * Mint a record, with its name bound as its first alias (`createPropWith`).
 *
 * The binding is what makes the record able to collect a line at all: the
 * evidence reading scores the page against a record's keys, and a record
 * with no key matches nothing. Unlike a location's set text, a prop alias
 * can never be "taken" - two props may both answer to the same spelling -
 * so this cannot half-fail.
 */
export const createProp = async (
  projectId: string,
  rawName: string,
  rawCategory: unknown = null,
  rawKey: unknown = null,
): Promise<CreateResult> => {
  const problem = createPropProblem(rawName, rawCategory, rawKey)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await createPropWith(gate, rawName, rawCategory, rawKey)
  if (result.status === 'created') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

export const saveProp = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const problem = propEditProblem(rawId, rawEdit)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await savePropWith(gate, rawId, rawEdit)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/**
 * Rename the record (`renamePropWith`). The alias that *is* the old name is
 * swapped for the new spelling; every other alias the writer bound stays
 * bound, because "the ball" is still what the page calls it. See the header
 * for why this is not a write-back.
 */
export const renameProp = async (projectId: string, rawId: string, rawName: string): Promise<SavedResult> => {
  const problem = renamePropProblem(rawId, rawName)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await renamePropWith(gate, rawId, rawName)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/**
 * Merge this record into another (`mergePropsWith`). The loser keeps its row
 * as a tombstone, so `/props/:loserId` redirects to the survivor, and both
 * Production columns that pointed at it are repointed in the same statement.
 */
export const mergeProps = async (projectId: string, rawLoser: string, rawWinner: string): Promise<MergeResult> => {
  const problem = mergePropProblem(rawLoser, rawWinner)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await mergePropsWith(gate, rawLoser, rawWinner)
  if (result.status === 'merged') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/**
 * Delete the record outright (`deletePropWith`).
 *
 * There is no "still in the script" refusal to make, and that is the
 * difference from `deleteLocation`: a location deleted under a live
 * heading is minted again by the next pass, so deleting one has to be
 * refused; nothing mints a prop, so a deleted prop stays deleted. Any shot
 * or scene setup that named it has its field cleared by the `set null` on
 * `prop_id` - which the drawer says in words before the button is pressed.
 */
export const deleteProp = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const problem = propIdProblem(rawId)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await deletePropWith(gate, rawId)
  if (result.status === 'deleted') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

// ---------------------------------------------------------------------------
// The photo
// ---------------------------------------------------------------------------

/** Store a photo for a record. The file is the `photo` entry of the form data. */
export const uploadPropPhoto = async (projectId: string, rawId: string, form: FormData): Promise<PhotoResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_PROP }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  if (!storageAvailable()) return { status: 'refused', message: 'Photo storage is not set up on this server yet.' }
  const image = await readImage(form.get('photo'), PROP_PHOTO_MAX_BYTES, 'photo')
  if (!image.ok) return { status: image.status, message: image.message }

  const key = `projects/${gate.project.id}/props/${id}/photo-${crypto.randomUUID()}.${IMAGE_EXTENSION[image.type]}`
  const put = await putObject(key, image.bytes, image.type)
  if (!put.ok) return { status: 'error', message: put.message }
  const pointed = await setPropPhotoKey(gate.scope, id, key)
  if (!pointed.found) {
    await deleteObject(key)
    return { status: 'error', message: REFUSED_PROP }
  }
  if (pointed.previous !== null && pointed.previous !== key) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: publicUrl(key) }
}

export const removePropPhoto = async (projectId: string, rawId: string): Promise<PhotoResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_PROP }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const pointed = await setPropPhotoKey(gate.scope, id, null)
  if (!pointed.found) return { status: 'error', message: REFUSED_PROP }
  if (pointed.previous !== null && storageAvailable()) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: null }
}

// ---------------------------------------------------------------------------
// The alias table
// ---------------------------------------------------------------------------

/**
 * Bind a spelling to a record - the write that makes "the ball" evidence
 * for the Game Ball, and the one that makes this route work at all.
 *
 * No `taken` outcome: `prop_aliases` has no unique index per project
 * (ruling: two props may both be "the bag"), so binding a spelling another
 * record already holds is allowed and both collect the line.
 */
export const bindAlias = async (projectId: string, rawId: string, rawAlias: string): Promise<BindResult> => {
  const id = parseId(rawId)
  const alias = PropAliasSchema.safeParse(rawAlias)
  if (id === null || !alias.success) return { status: 'error', message: 'A spelling is one line, up to 200 characters.' }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  const outcome = await bindPropAlias(gate.scope, id, alias.data)
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_PROP }
  if (outcome.status === 'already') return { status: 'refused', message: 'That spelling is already bound here.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'bound' }
}

/** Unbind a spelling. Refused when it is the record's last - see the repository. */
export const unbindAlias = async (projectId: string, rawId: string, rawAlias: string): Promise<SavedResult> => {
  const id = parseId(rawId)
  const alias = PropAliasSchema.safeParse(rawAlias)
  if (id === null || !alias.success) return { status: 'error', message: REFUSED_PROP }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  const outcome = await unbindPropAlias(gate.scope, id, alias.data)
  if (outcome === 'missing') return { status: 'error', message: 'That spelling is not bound here.' }
  if (outcome === 'last') {
    return { status: 'refused', message: 'The only spelling bound here. Rename the prop, or bind another first.' }
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}
