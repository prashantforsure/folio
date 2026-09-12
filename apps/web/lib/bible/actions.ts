'use server'

import {
  BibleConflictEditSchema,
  BibleEntryCreateSchema,
  BibleEntryEditSchema,
  BibleEntryIdSchema,
  BibleEntryStatusSchema,
  BibleFactEditSchema,
  BibleFactIdSchema,
  BiblePitchFieldEditSchema,
  BiblePitchFieldIdSchema,
  BibleQuestionEditSchema,
  BibleQuestionIdSchema,
  BibleTermEditSchema,
  BibleTermIdSchema,
} from '@folio/contracts'
import {
  addBibleFact,
  addBiblePitchField,
  addBibleQuestion,
  addBibleTerm,
  clearBibleConflict,
  countOpenCanonConflicts,
  createBibleEntry,
  createPitch,
  deleteBibleFact,
  deleteBiblePitchField,
  deleteBibleQuestion,
  deleteBibleTerm,
  listBibleFacts,
  openThread,
  recordBibleConflict,
  rewriteBibleFactAndClearConflict,
  setBibleEntryStatus,
  setBibleQuestionResolved,
  updateBibleEntry,
  updateBibleFact,
  updateBiblePitchField,
  updateBibleTerm,
} from '@folio/db'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openProject } from '../script/gate'
import type {
  ConflictDecision,
  ConflictResult,
  EntryResult,
  FactResult,
  FieldResult,
  QuestionResult,
  SavedResult,
  TermResult,
} from './result'

/**
 * The Bible route's writes.
 *
 * Every one goes gate -> repository -> result, through the project-scoped
 * gate in `lib/script/gate.ts`: identity, membership, scope, project.
 * Membership, not role - unchanged from every earlier phase and flagged
 * again.
 *
 * ## Nothing here re-derives
 *
 * Every write is authored data on an authored table; nothing about the
 * script changed, so no derivation pass runs. The one thing that reaches
 * the script is `decideConflict`'s "Rule is right · flag scene", and what
 * it writes is a **comment thread** on the scene's heading node
 * (`openThread`) - the Notes inbox's row, never a node. AGENTS.md's
 * exception table: derivation is one-way except two renames, and this is
 * not a third.
 *
 * ## The agent does not come through here
 *
 * "Bible: write **only** on an explicit instruction in the current
 * message." There is no agent yet; when one exists its bible writes are a
 * proposal set, not these actions, and the status gate it must respect is
 * `listCanonFacts` in the repository, not anything the UI does.
 *
 * ## Status is the one write that changes what AI can see
 *
 * `setStatus` moves an entry between `draft`, `canon` and `retired`. It is
 * a column write like any other here; what makes it a permission is that
 * the context builder's read filters on it (`repositories/bible.ts`).
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const UNREADABLE = 'That edit could not be read.'
const MISSING_ENTRY = 'That entry could not be found.'
const MISSING_ROW = 'That row could not be found.'

const parse = <T>(schema: z.ZodType<T, unknown>, raw: unknown): T | null => {
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const idOf = <T>(schema: z.ZodType<T, string>, raw: unknown): T | null =>
  parse(schema, typeof raw === 'string' ? raw : '')

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export const createEntry = async (projectId: string, rawCreate: unknown): Promise<EntryResult> => {
  const create = parse(BibleEntryCreateSchema, rawCreate)
  if (create === null) return { status: 'error', message: 'An entry needs a title, up to 200 characters, and a section.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const id = await createBibleEntry(gate.scope, create)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

/**
 * The Pitch, and the empty state's "Start with sections": the one entry
 * every bible opens with, in Premise, with its seven fields. Refused when
 * the project already has one.
 */
export const createPitchEntry = async (projectId: string): Promise<EntryResult> => {
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const id = await createPitch(gate.scope)
  if (id === null) return { status: 'refused', message: 'This project already has a Pitch.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

export const saveEntry = async (projectId: string, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const id = idOf(BibleEntryIdSchema, rawId)
  const edit = parse(BibleEntryEditSchema, rawEdit)
  if (id === null || edit === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const written = await updateBibleEntry(gate.scope, id, edit)
  if (!written) return { status: 'error', message: MISSING_ENTRY }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const setStatus = async (projectId: string, rawId: unknown, rawStatus: unknown): Promise<SavedResult> => {
  const id = idOf(BibleEntryIdSchema, rawId)
  const status = parse(BibleEntryStatusSchema, rawStatus)
  if (id === null || status === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const written = await setBibleEntryStatus(gate.scope, id, status)
  if (!written) return { status: 'error', message: MISSING_ENTRY }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export const addFact = async (projectId: string, rawEntryId: unknown, rawEdit: unknown): Promise<FactResult> => {
  const entryId = idOf(BibleEntryIdSchema, rawEntryId)
  const edit = parse(BibleFactEditSchema, rawEdit)
  if (entryId === null || edit === null) return { status: 'error', message: 'A rule needs its text, up to 2,000 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const id = await addBibleFact(gate.scope, entryId, edit)
  if (id === null) return { status: 'error', message: MISSING_ENTRY }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', id }
}

export const saveFact = async (projectId: string, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const id = idOf(BibleFactIdSchema, rawId)
  const edit = parse(BibleFactEditSchema, rawEdit)
  if (id === null || edit === null) return { status: 'error', message: 'A rule needs its text, up to 2,000 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const written = await updateBibleFact(gate.scope, id, edit)
  if (!written) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const removeFact = async (projectId: string, rawId: unknown): Promise<SavedResult> => {
  const id = idOf(BibleFactIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const removed = await deleteBibleFact(gate.scope, id)
  if (!removed) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/** Record a conflict on a rule: the scene that contradicts it, and how. */
export const recordConflict = async (projectId: string, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const id = idOf(BibleFactIdSchema, rawId)
  const edit = parse(BibleConflictEditSchema, rawEdit)
  if (id === null || edit === null) return { status: 'error', message: 'A conflict needs a scene and a note.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const written = await recordBibleConflict(gate.scope, id, edit)
  if (!written) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

const DecisionSchema: z.ZodType<ConflictDecision, unknown> = z.discriminatedUnion('choice', [
  /** Rule is right · flag scene: a comment thread on the scene, then the conflict is decided. */
  z.object({ choice: z.literal('rule') }),
  /** Scene is right · update rule: the rule's new text, and the conflict is decided. */
  z.object({ choice: z.literal('scene'), text: z.string().trim().min(1).max(2_000) }),
  /** Both fine: the conflict is decided. */
  z.object({ choice: z.literal('both') }),
])


/**
 * Decide an open conflict. "Rule is right" leaves a durable mark on the
 * scene - a comment thread on its heading node, quoting the rule - so the
 * Notes inbox and the Script route carry the flag; "Scene is right" is the
 * rule's rewrite; "Both fine" is neither. All three end with the conflict
 * off the fact. The count that comes back is the badge.
 */
export const decideConflict = async (
  projectId: string,
  rawId: unknown,
  rawDecision: unknown,
): Promise<ConflictResult> => {
  const id = idOf(BibleFactIdSchema, rawId)
  const decision = parse(DecisionSchema, rawDecision)
  if (id === null || decision === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  if (decision.choice === 'scene') {
    const written = await rewriteBibleFactAndClearConflict(scope, id, decision.text)
    if (!written) return { status: 'error', message: MISSING_ROW }
  } else {
    if (decision.choice === 'rule') {
      const fact = (await listBibleFacts(scope)).find((row) => row.id === id)
      if (fact === undefined) return { status: 'error', message: MISSING_ROW }
      if (fact.conflictSceneId !== null && fact.conflictNote !== null) {
        await openThread(
          scope,
          { kind: 'script_node', nodeId: fact.conflictSceneId },
          `Canon · ${fact.entryTitle}\n“${fact.text}”\nThis scene contradicts it: ${fact.conflictNote}`,
        )
      }
    }
    const cleared = await clearBibleConflict(scope, id)
    if (!cleared) return { status: 'error', message: MISSING_ROW }
  }

  const open = await countOpenCanonConflicts(scope)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'decided', open }
}

// ---------------------------------------------------------------------------
// Open questions
// ---------------------------------------------------------------------------

export const addQuestion = async (projectId: string, rawEntryId: unknown, rawEdit: unknown): Promise<QuestionResult> => {
  const entryId = idOf(BibleEntryIdSchema, rawEntryId)
  const edit = parse(BibleQuestionEditSchema, rawEdit)
  if (entryId === null || edit === null) return { status: 'error', message: 'A question needs its text, up to 1,000 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const id = await addBibleQuestion(gate.scope, entryId, edit.text)
  if (id === null) return { status: 'error', message: MISSING_ENTRY }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', id }
}

export const setQuestionResolved = async (
  projectId: string,
  rawId: unknown,
  resolved: boolean,
): Promise<SavedResult> => {
  const id = idOf(BibleQuestionIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const written = await setBibleQuestionResolved(gate.scope, id, resolved === true)
  if (!written) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const removeQuestion = async (projectId: string, rawId: unknown): Promise<SavedResult> => {
  const id = idOf(BibleQuestionIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const removed = await deleteBibleQuestion(gate.scope, id)
  if (!removed) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// The Pitch's fields
// ---------------------------------------------------------------------------

export const addField = async (projectId: string, rawEntryId: unknown, rawEdit: unknown): Promise<FieldResult> => {
  const entryId = idOf(BibleEntryIdSchema, rawEntryId)
  const edit = parse(BiblePitchFieldEditSchema, rawEdit)
  if (entryId === null || edit === null) return { status: 'error', message: 'A field needs a name, up to 60 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const id = await addBiblePitchField(gate.scope, entryId, edit)
  if (id === null) return { status: 'error', message: 'Fields belong to the Pitch.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', id }
}

export const saveField = async (projectId: string, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const id = idOf(BiblePitchFieldIdSchema, rawId)
  const edit = parse(BiblePitchFieldEditSchema, rawEdit)
  if (id === null || edit === null) return { status: 'error', message: 'A field needs a name, up to 60 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const written = await updateBiblePitchField(gate.scope, id, edit)
  if (!written) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const removeField = async (projectId: string, rawId: unknown): Promise<SavedResult> => {
  const id = idOf(BiblePitchFieldIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const removed = await deleteBiblePitchField(gate.scope, id)
  if (!removed) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// The glossary
// ---------------------------------------------------------------------------

const TERM_TAKEN = 'That term is already in the glossary.'

export const addTerm = async (projectId: string, rawEdit: unknown): Promise<TermResult> => {
  const edit = parse(BibleTermEditSchema, rawEdit)
  if (edit === null) return { status: 'error', message: 'A term needs a word, up to 80 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const id = await addBibleTerm(gate.scope, edit)
  if (id === null) return { status: 'refused', message: TERM_TAKEN }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', id }
}

export const saveTerm = async (projectId: string, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const id = idOf(BibleTermIdSchema, rawId)
  const edit = parse(BibleTermEditSchema, rawEdit)
  if (id === null || edit === null) return { status: 'error', message: 'A term needs a word, up to 80 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const outcome = await updateBibleTerm(gate.scope, id, edit)
  if (outcome === 'taken') return { status: 'refused', message: TERM_TAKEN }
  if (outcome === 'missing') return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const removeTerm = async (projectId: string, rawId: unknown): Promise<SavedResult> => {
  const id = idOf(BibleTermIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const removed = await deleteBibleTerm(gate.scope, id)
  if (!removed) return { status: 'error', message: MISSING_ROW }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}
