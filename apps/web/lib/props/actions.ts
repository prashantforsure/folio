'use server'

import { PROP_PHOTO_MAX_BYTES, PropAliasSchema, PropEditSchema, PropIdSchema, TitleSchema } from '@folio/contracts'
import {
  bindPropAlias,
  createPropRecord,
  deletePropRecord,
  listPropAliases,
  listPropRecords,
  mergePropRecords,
  renamePropRecord,
  setPropPhotoKey,
  unbindPropAlias,
  updatePropRecord,
} from '@folio/db'
import type { PropId } from '@folio/script'
import { canonicalKey } from '@folio/script'
import { revalidatePath } from 'next/cache'

import { isRefusal, openProject } from '../script/gate'
import { IMAGE_EXTENSION, readImage } from '../storage/image'
import { deleteObject, publicUrl, putObject, storageAvailable } from '../storage/r2'
import type { BindResult, CreateResult, DeleteResult, MergeResult, PhotoResult, SavedResult } from './result'
import { REFUSED_NAME, REFUSED_PROP } from './result'

/**
 * The Props route's writes.
 *
 * Every one goes Zod parse -> gate -> repository -> revalidate -> result,
 * through the project-scoped gate in `lib/script/gate.ts`, as the
 * Characters and Locations routes' do. **Membership, not role** - AGENTS.md
 * open decision 16 is still open and `memberships.role` is enforced
 * nowhere, so this route decides not to check it like every action written
 * since. Flagged again rather than quietly resolved.
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
 * route also copies: `storageAvailable()` first, then the byte cap, then
 * the MIME sniffed **from the bytes** rather than trusted from the form,
 * then `putObject`, then the row is pointed at the new key - and only then
 * is the old object deleted. Nothing is deleted before the row says the
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
 * Mint a record, with its name bound as its first alias.
 *
 * The binding is what makes the record able to collect a line at all: the
 * evidence reading scores the page against a record's keys, and a record
 * with no key matches nothing. Unlike a location's set text, a prop alias
 * can never be "taken" - two props may both answer to the same spelling -
 * so this cannot half-fail.
 */
export const createProp = async (projectId: string, rawName: string, rawCategory: unknown = null): Promise<CreateResult> => {
  const name = TitleSchema.safeParse(rawName)
  const category = PropEditSchema.shape.category.safeParse(rawCategory ?? null)
  if (!name.success || !category.success) return { status: 'error', message: REFUSED_NAME }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const trimmed = category.data ?? null
  const id = await createPropRecord(gate.scope, name.data, trimmed === '' ? null : trimmed)
  await bindPropAlias(gate.scope, id, name.data)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

export const saveProp = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const edit = PropEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That edit could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await updatePropRecord(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_PROP }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/**
 * Rename the record. The alias that *is* the old name is swapped for the
 * new spelling; every other alias the writer bound stays bound, because
 * "the ball" is still what the page calls it. See the header for why this
 * is not a write-back.
 */
export const renameProp = async (projectId: string, rawId: string, rawName: string): Promise<SavedResult> => {
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: REFUSED_NAME }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const [records, aliases] = await Promise.all([listPropRecords(gate.scope), listPropAliases(gate.scope)])
  const record = records.find((entry) => entry.id === id)
  if (record === undefined) return { status: 'error', message: REFUSED_PROP }
  const oldKey = canonicalKey(record.name)
  const oldAliases = aliases
    .filter((entry) => entry.propId === id && canonicalKey(entry.alias) === oldKey)
    .map((entry) => entry.alias)

  const outcome = await renamePropRecord(gate.scope, id, name.data, oldAliases, name.data)
  if (outcome.status !== 'renamed') return { status: 'error', message: REFUSED_PROP }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/**
 * Merge this record into another. The loser keeps its row as a tombstone,
 * so `/props/:loserId` redirects to the survivor, and both Production
 * columns that pointed at it are repointed in the same statement.
 */
export const mergeProps = async (projectId: string, rawLoser: string, rawWinner: string): Promise<MergeResult> => {
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  if (loser === null || winner === null) return { status: 'error', message: REFUSED_PROP }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await mergePropRecords(gate.scope, loser, winner)
  if (outcome.status === 'same') return { status: 'refused', message: 'A prop cannot be merged into itself.' }
  if (outcome.status !== 'merged') return { status: 'error', message: REFUSED_PROP }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'merged', into: outcome.into }
}

/**
 * Delete the record outright.
 *
 * There is no "still in the script" refusal to make, and that is the
 * difference from `deleteLocation`: a location deleted under a live
 * heading is minted again by the next pass, so deleting one has to be
 * refused; nothing mints a prop, so a deleted prop stays deleted. Any shot
 * or scene setup that named it has its field cleared by the `set null` on
 * `prop_id` - which the drawer says in words before the button is pressed.
 */
export const deleteProp = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_PROP }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const before = (await listPropRecords(gate.scope)).find((entry) => entry.id === id)
  const deleted = await deletePropRecord(gate.scope, id)
  if (!deleted) return { status: 'error', message: REFUSED_PROP }
  if (before?.photoKey != null && storageAvailable()) await deleteObject(before.photoKey)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// The photo
// ---------------------------------------------------------------------------

/** Store a photo for a record. The file is the `photo` entry of the form data. */
export const uploadPropPhoto = async (projectId: string, rawId: string, form: FormData): Promise<PhotoResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_PROP }
  if (!storageAvailable()) return { status: 'refused', message: 'Photo storage is not set up on this server yet.' }
  const image = await readImage(form.get('photo'), PROP_PHOTO_MAX_BYTES, 'photo')
  if (!image.ok) return { status: image.status, message: image.message }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

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
  const gate = await openProject(projectId)
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
  const gate = await openProject(projectId)
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
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await unbindPropAlias(gate.scope, id, alias.data)
  if (outcome === 'missing') return { status: 'error', message: 'That spelling is not bound here.' }
  if (outcome === 'last') {
    return { status: 'refused', message: 'The only spelling bound here. Rename the prop, or bind another first.' }
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}
