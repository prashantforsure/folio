'use server'

import type { TextExportResult } from '../workspace/export'
import { charactersCsv } from './server'

import {
  CanvasPositionSchema,
  CharacterIdSchema,
  NewCharacterSchema,
  PORTRAIT_MAX_BYTES,
  PORTRAIT_TYPES,
} from '@folio/contracts'
import type { PortraitType } from '@folio/contracts'
import { listEpisodes, placeCharacter, recordDecisionByKey, setPortraitKey } from '@folio/db'
import type { CharacterId } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import { isRefusal, openProject } from '../script/gate'
import { rederiveProject } from '../script/server'
import { deleteObject, publicUrl, putObject, storageAvailable } from '../storage/r2'
import {
  characterIdProblem,
  deleteCharacterWith,
  deleteRelationshipWith,
  mergeCharacterInto,
  mergeCharactersWith,
  mergeProblem,
  pairProblem,
  previewRenameWith,
  profileProblem,
  relationshipProblem,
  renameCharacterWith,
  renameProblem,
  resolveCueProblem,
  resolveCueWith,
  revokeDecisionWith,
  revokeProblem,
  saveProfileWith,
  saveRelationshipWith,
  undoRenameProblem,
  undoRenameWith,
} from './core'
import { createCharacterIn } from './create'
import type {
  CreateResult,
  DeleteResult,
  DeriveResult,
  MergeResult,
  PairResult,
  PlaceResult,
  PortraitResult,
  RelationshipResult,
  RenamePreview,
  RenameResult,
  ResolveResult,
  SavedResult,
  UndoRenameResult,
} from './result'
import { pairDecisionKey } from './server'

/**
 * The Characters route's writes.
 *
 * Every one goes gate -> repository -> (pipeline) -> result, through the
 * project-scoped gate in `lib/script/gate.ts`: identity, membership, scope,
 * project, and the capability each write needs - `ROLE.entityOperation` for
 * the record operations, `ROLE.authoredEdit` for a field or a portrait,
 * `ROLE.read` for the rename preview (ADR 0003 D2, `lib/auth/roles.ts`).
 *
 * ## Thin actions over core functions (roadmap task 4.2)
 *
 * Every write the agent's tools reach is split: the body is a core function in
 * `core.ts` that takes a gate and the raw input - which the tools and the
 * worker call with a gate of their own - and the action here parses what it
 * always parsed before the gate, opens the cookie gate with its capability,
 * calls the core, and revalidates on the outcome it always did. Signatures and
 * results are unchanged. The actions no tool reaches (the portrait, the
 * canvas, the pair row, the derive button, the export) are as they were.
 *
 * ## Which writes re-derive, and which do not
 *
 * A profile field, a portrait: authored data on the record, and nothing
 * about the script changed, so nothing is re-derived - a pass that runs
 * later leaves these rows alone because `commitDerivation` never touches
 * an authored table.
 *
 * Binding a cue, a queue decision, a merge, a rename: each changes what the
 * alias table says, and so what the next pass resolves. Each **awaits** a
 * project-wide re-derive before answering, because what the writer sees
 * next - the queue's rows, the counts, the grid - is that pass's output.
 *
 * ## The rename is the sanctioned write-back
 *
 * AGENTS.md, "Derivation is one-way - except": a character record rename is
 * "an explicit rewrite operation, returns a diff, single undo entry".
 * `renameCharacter` is that operation and nothing else here writes a node:
 * the pure core's `renameCharacterCues` decides which cues change, a
 * `before_rename` version is taken of every document it touches, the cues
 * are rewritten in one statement, and the count comes back as the diff.
 * `previewRename` is the same decision as a read - the diff before it is
 * taken - so the confirm can say what will change and what stays bound.
 * `undoRename` is the same operation in reverse: the old text goes back by
 * node id (`revertCueRewrites`, never a second rename), behind its own
 * `before_rename` snapshot, so the undo of the sanctioned write-back is as
 * explicit as the write-back was and a cue edited since is left alone.
 *
 * ## Two records, one person
 *
 * `decidePair` answers the queue's pair row (`similarRecords`): `merge` is
 * the same merge the rename's `taken` door does; `different` writes a
 * `record:<a>:<b>` rejection through `recordDecisionByKey` so the pair is
 * never asked about again. The key is never a queue row's, so a pass never
 * sees it.
 *
 * ## Walk-on is one act, and every act can be taken back
 *
 * "Not a character." The pure core keeps a row open with no proposal once
 * every candidate and `new-record` have been rejected, and never asks
 * again. So the decision records exactly those rejections -
 * `matchCharacters` lists the candidates by the same scoring the queue
 * uses - in one insert, then re-derives. The row stays open, un-proposed,
 * leaves the badge, and is listed under the queue as a walk-on.
 *
 * `revokeDecision` is the reverse of every queue decision: the rows it
 * wrote are deleted (`deleteResolveDecisions` - the insert is idempotent on
 * the row and target, so deciding the opposite way is a no-op without it),
 * an accepted spelling is unbound, a `New character` that is still blank is
 * deleted, and the project re-derives so the cue is asked about again.
 *
 * ## The alias table is written by the queue
 *
 * Since the fourth pass (2026-09-20) the only doors into the alias table
 * are the queue's: `resolveCue` binds a spelling, `revokeDecision` unbinds
 * it, `mergeCharacters` (the rename's `taken` door, and the queue's pair
 * row) moves every spelling to the winner. The drawer's bind / move /
 * split / unbind doors went with the alias table.
 *
 * ## The canvas and the graph
 *
 * `placeCharacterOnCanvas` writes where a card was dropped; `saveRelationship`
 * and `deleteRelationship` write one authored row per pair. None of the
 * three re-derives: nothing derived reads them.
 *
 * ## A portrait goes through the action, not past it
 *
 * The **gate runs first**, before a byte of the body is read. `File.arrayBuffer()`
 * buffers the whole upload into this process's memory, so reading it before
 * membership is known let anyone signed out make the server hold the entire
 * body limit per request; the size cap does not help, because the cap is
 * checked after the platform has already accepted the body. Identity, then
 * membership, then anything expensive - AGENTS.md, Feature workflow 7.
 *
 * Then the file arrives as `FormData`, is capped at `PORTRAIT_MAX_BYTES`, has
 * its first bytes sniffed (the declared MIME is not trusted), is PUT to
 * storage under `projects/<projectId>/characters/<characterId>/`, and only
 * then does the row point at it; the object it replaced is deleted after
 * the row says so, never before. No browser ever holds a storage
 * credential, and `next.config.ts` raises the action body limit for it.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const REFUSED_CHARACTER = 'That character could not be found.'

const parseId = (raw: unknown): CharacterId | null => {
  const parsed = CharacterIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export const createCharacter = async (projectId: string, rawInput: unknown, rawKey: unknown = null): Promise<CreateResult> => {
  const input = NewCharacterSchema.safeParse(rawInput)
  if (!input.success) return { status: 'error', message: 'A character needs a name, up to 200 characters.' }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  // One path with the agent's `create_character` (`./create.ts`); a person's record is `hand`.
  const id = await createCharacterIn(gate.scope, input.data, key.key, 'hand')
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

export const saveProfile = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const problem = profileProblem(rawId, rawEdit)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await saveProfileWith(gate, rawId, rawEdit)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** The record-level rename (`renameCharacterWith`). See the header. */
export const renameCharacter = async (projectId: string, rawId: string, rawName: string): Promise<RenameResult> => {
  const problem = renameProblem(rawId, rawName)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await renameCharacterWith(gate, rawId, rawName)
  if (result.status === 'renamed') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** Take a rename back (`undoRenameWith`). */
export const undoRename = async (projectId: string, rawId: string, rawRestore: unknown): Promise<UndoRenameResult> => {
  const problem = undoRenameProblem(rawId, rawRestore)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await undoRenameWith(gate, rawId, rawRestore)
  if (result.status === 'undone') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** What a rename would do, before it does (`previewRenameWith`). Nothing written. */
export const previewRename = async (projectId: string, rawId: string, rawName: string): Promise<RenamePreview> => {
  const problem = renameProblem(rawId, rawName)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  return previewRenameWith(gate, rawId, rawName)
}

export const mergeCharacters = async (projectId: string, rawLoser: string, rawWinner: string): Promise<MergeResult> => {
  const problem = mergeProblem(rawLoser, rawWinner)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await mergeCharactersWith(gate, rawLoser, rawWinner)
  if (result.status === 'merged') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/**
 * The queue's pair row: `Merge into <keep>` folds `other` into `keep`;
 * `They're different people` records a rejection under the pair's key so
 * the pair is never listed again. See the header.
 */
export const decidePair = async (
  projectId: string,
  rawKeep: string,
  rawOther: string,
  rawVerdict: unknown,
): Promise<PairResult> => {
  const keep = parseId(rawKeep)
  const other = parseId(rawOther)
  const verdict = z.enum(['merge', 'different']).safeParse(rawVerdict)
  if (keep === null || other === null || keep === other || !verdict.success) {
    return { status: 'error', message: 'That decision could not be read.' }
  }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  if (verdict.data === 'merge') {
    const merged = await mergeCharacterInto(gate.scope, other, keep)
    if (merged.status === 'merged') revalidatePath(workspacePath(gate.project.id), 'layout')
    return merged
  }
  await recordDecisionByKey(gate.scope, pairDecisionKey(keep, other), 'rejected', { kind: 'character', id: other })
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'different' }
}

export const deleteCharacter = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const problem = characterIdProblem(rawId)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await deleteCharacterWith(gate, rawId)
  if (result.status === 'deleted') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

// ---------------------------------------------------------------------------
// The portrait
// ---------------------------------------------------------------------------

/** The first bytes of the three formats accepted. The declared type is checked against these, not trusted. */
const sniff = (bytes: Uint8Array): PortraitType | null => {
  const at = (index: number): number => bytes[index] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

const EXTENSION: Readonly<Record<PortraitType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Store a portrait for a record. The file is the `portrait` entry of the
 * form data. See the header for the order of operations.
 */
export const uploadPortrait = async (projectId: string, rawId: string, form: FormData): Promise<PortraitResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  if (!storageAvailable()) return { status: 'refused', message: 'Portrait storage is not set up on this server yet.' }
  const entry = form.get('portrait')
  if (!(entry instanceof File)) return { status: 'error', message: 'Pick an image to upload.' }
  if (entry.size === 0) return { status: 'error', message: 'That file is empty.' }
  if (entry.size > PORTRAIT_MAX_BYTES) {
    return { status: 'refused', message: `A portrait is at most ${String(PORTRAIT_MAX_BYTES / (1024 * 1024))} MB.` }
  }
  const bytes = new Uint8Array(await entry.arrayBuffer())
  const type = sniff(bytes)
  if (type === null || !(PORTRAIT_TYPES as readonly string[]).includes(type)) {
    return { status: 'refused', message: 'A portrait is a PNG, JPEG or WebP image.' }
  }

  const key = `projects/${gate.project.id}/characters/${id}/portrait-${crypto.randomUUID()}.${EXTENSION[type]}`
  const put = await putObject(key, bytes, type)
  if (!put.ok) return { status: 'error', message: put.message }
  const pointed = await setPortraitKey(gate.scope, id, key)
  if (!pointed.found) {
    await deleteObject(key)
    return { status: 'error', message: REFUSED_CHARACTER }
  }
  if (pointed.previous !== null && pointed.previous !== key) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: publicUrl(key) }
}

export const removePortrait = async (projectId: string, rawId: string): Promise<PortraitResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const pointed = await setPortraitKey(gate.scope, id, null)
  if (!pointed.found) return { status: 'error', message: REFUSED_CHARACTER }
  if (pointed.previous !== null && storageAvailable()) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: null }
}

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

export const resolveCue = async (projectId: string, rawKey: string, rawChoice: unknown): Promise<ResolveResult> => {
  const problem = resolveCueProblem(rawKey, rawChoice)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await resolveCueWith(gate, rawKey, rawChoice)
  if (result.status === 'resolved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/**
 * Take a queue decision back (`revokeDecisionWith`). The decisions are rows
 * and the insert is idempotent on the row and its target, so the reverse is a
 * delete of exactly the rows that decision wrote, then whatever it bound or
 * minted is undone, then the project re-derives so the cue is asked about
 * again.
 */
export const revokeDecision = async (projectId: string, rawKey: string, rawUndo: unknown): Promise<ResolveResult> => {
  const problem = revokeProblem(rawKey, rawUndo)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await revokeDecisionWith(gate, rawKey, rawUndo)
  if (result.status === 'resolved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

// ---------------------------------------------------------------------------
// The canvas and the graph (the fourth pass, 2026-09-20)
// ---------------------------------------------------------------------------

/**
 * Put a card where the canvas dropped it (`lib/storyboard/actions.ts`,
 * `placeShotOnCanvas`'s shape). Cosmetic - nothing derived reads it - so
 * nothing re-derives, and the layout is not revalidated: the canvas holds
 * the point optimistically and the next read agrees with it.
 */
export const placeCharacterOnCanvas = async (projectId: string, rawId: string, rawPosition: unknown): Promise<PlaceResult> => {
  const id = parseId(rawId)
  const position = CanvasPositionSchema.safeParse(rawPosition)
  if (id === null || !position.success) return { status: 'error', message: 'A card goes at a whole x and y.' }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const written = await placeCharacter(gate.scope, id, position.data)
  if (!written) return { status: 'error', message: REFUSED_CHARACTER }
  return { status: 'placed' }
}

/**
 * Write a pair's relationship, whole - the modal's `Create` and `Save`
 * (`saveRelationshipWith`). Authored beside the record, never derived from it:
 * nothing re-derives, and the label `derive.ts` reads next pass is this row's.
 */
export const saveRelationship = async (projectId: string, rawInput: unknown): Promise<RelationshipResult> => {
  const problem = relationshipProblem(rawInput)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await saveRelationshipWith(gate, rawInput)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

export const deleteRelationship = async (projectId: string, rawA: string, rawB: string): Promise<RelationshipResult> => {
  const problem = pairProblem(rawA, rawB)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await deleteRelationshipWith(gate, rawA, rawB)
  if (result.status === 'gone') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** The empty state's "Derive N characters": a pass, awaited, project-wide. */
export const deriveNow = async (projectId: string): Promise<DeriveResult> => {
  const gate = await openProject(projectId, ROLE.derive)
  if (isRefusal(gate)) return gate
  const pass = await rederiveProject(gate.scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return {
    status: 'derived',
    characters: pass.derivation.entities.characters.filter((record) => record.presence === 'present').length,
  }
}

// ---------------------------------------------------------------------------
// Export (roadmap task 2.4)
// ---------------------------------------------------------------------------

const CastColumnsSchema = z.object({ words: z.boolean(), share: z.boolean(), episodes: z.boolean() })

/** The List view's CSV, for the requesting user (`ROLE.export`, ADR 0003 D16). */
export const exportCharactersCsv = async (projectId: string, rawColumns: unknown): Promise<TextExportResult> => {
  const columns = CastColumnsSchema.safeParse(rawColumns ?? { words: false, share: false, episodes: false })
  if (!columns.success) return { status: 'error', message: 'Those columns could not be read.' }
  const gate = await openProject(projectId, ROLE.export)
  if (isRefusal(gate)) return gate
  return { status: 'exported', ...(await charactersCsv({ scope: gate.scope, episodes: await listEpisodes(gate.scope) }, columns.data)) }
}
