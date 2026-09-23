import { PropEditSchema, PropIdSchema, TitleSchema } from '@folio/contracts'
import { bindPropAlias, createPropRecord, deletePropRecord, listPropAliases, listPropRecords, mergePropRecords, renamePropRecord, updatePropRecord } from '@folio/db'
import type { PropId } from '@folio/script'
import { canonicalKey } from '@folio/script'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import type { ProjectGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import { deleteObject, storageAvailable } from '../storage/r2'
import type { CreateResult, DeleteResult, MergeResult, SavedResult } from './result'
import { REFUSED_NAME, REFUSED_PROP } from './result'

/**
 * The Props route's record writes as **core functions** - roadmap task 4.2.
 *
 * Each takes a gate already opened and the raw input its action takes, checks
 * the role itself, and does everything the action did after its gate except
 * `revalidatePath` (the action's, `actions.ts`, whose header says why nothing
 * here re-derives and why a rename is not a write-back). The agent's tools and
 * the worker call these with a gate of their own.
 */

type Problem = { readonly status: 'error'; readonly message: string }

const parseId = (raw: unknown): PropId | null => {
  const parsed = PropIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

const CategorySchema = PropEditSchema.shape.category

export const createPropProblem = (rawName: unknown, rawCategory: unknown, rawKey: unknown): Problem | null => {
  if (!TitleSchema.safeParse(rawName).success || !CategorySchema.safeParse(rawCategory ?? null).success) return { status: 'error', message: REFUSED_NAME }
  if (!idempotencyKeyOf(rawKey).ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  return null
}

/** Mint a record, with its name bound as its first alias - a record with no key matches nothing. */
export const createPropWith = async (gate: ProjectGate, rawName: unknown, rawCategory: unknown = null, rawKey: unknown = null): Promise<CreateResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const name = TitleSchema.safeParse(rawName)
  const category = CategorySchema.safeParse(rawCategory ?? null)
  if (!name.success || !category.success) return { status: 'error', message: REFUSED_NAME }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }

  const trimmed = category.data ?? null
  const id = await createPropRecord(gate.scope, name.data, trimmed === '' ? null : trimmed, key.key)
  await bindPropAlias(gate.scope, id, name.data)
  return { status: 'created', id }
}

export const propEditProblem = (rawId: unknown, rawEdit: unknown): Problem | null =>
  parseId(rawId) === null || !PropEditSchema.safeParse(rawEdit).success ? { status: 'error', message: 'That edit could not be read.' } : null

export const savePropWith = async (gate: ProjectGate, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const edit = PropEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That edit could not be read.' }
  const written = await updatePropRecord(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_PROP }
  return { status: 'saved' }
}

export const renamePropProblem = (rawId: unknown, rawName: unknown): Problem | null =>
  parseId(rawId) === null || !TitleSchema.safeParse(rawName).success ? { status: 'error', message: REFUSED_NAME } : null

/** Rename the record: the alias that *is* the old name is swapped for the new spelling; no node is touched. */
export const renamePropWith = async (gate: ProjectGate, rawId: unknown, rawName: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: REFUSED_NAME }

  const [records, aliases] = await Promise.all([listPropRecords(gate.scope), listPropAliases(gate.scope)])
  const record = records.find((entry) => entry.id === id)
  if (record === undefined) return { status: 'error', message: REFUSED_PROP }
  const oldKey = canonicalKey(record.name)
  const oldAliases = aliases
    .filter((entry) => entry.propId === id && canonicalKey(entry.alias) === oldKey)
    .map((entry) => entry.alias)

  const outcome = await renamePropRecord(gate.scope, id, name.data, oldAliases, name.data)
  if (outcome.status !== 'renamed') return { status: 'error', message: REFUSED_PROP }
  return { status: 'saved' }
}

export const mergePropProblem = (rawLoser: unknown, rawWinner: unknown): Problem | null =>
  parseId(rawLoser) === null || parseId(rawWinner) === null ? { status: 'error', message: REFUSED_PROP } : null

/** Merge this record into another; the loser stays as a tombstone that redirects. */
export const mergePropsWith = async (gate: ProjectGate, rawLoser: unknown, rawWinner: unknown): Promise<MergeResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  if (loser === null || winner === null) return { status: 'error', message: REFUSED_PROP }

  const outcome = await mergePropRecords(gate.scope, loser, winner)
  if (outcome.status === 'same') return { status: 'refused', message: 'A prop cannot be merged into itself.' }
  if (outcome.status !== 'merged') return { status: 'error', message: REFUSED_PROP }
  return { status: 'merged', into: outcome.into }
}

export const propIdProblem = (rawId: unknown): Problem | null => (parseId(rawId) === null ? { status: 'error', message: REFUSED_PROP } : null)

/** Delete the record outright - nothing mints a prop, so a deleted prop stays deleted. */
export const deletePropWith = async (gate: ProjectGate, rawId: unknown): Promise<DeleteResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_PROP }

  const before = (await listPropRecords(gate.scope)).find((entry) => entry.id === id)
  const deleted = await deletePropRecord(gate.scope, id)
  if (!deleted) return { status: 'error', message: REFUSED_PROP }
  if (before?.photoKey != null && storageAvailable()) await deleteObject(before.photoKey)
  return { status: 'deleted' }
}
