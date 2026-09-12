import type {
  BibleConflictEdit,
  BibleEntryCreate,
  BibleEntryEdit,
  BibleEntryId,
  BibleFactEdit,
  BibleFactId,
  BiblePitchFieldEdit,
  BiblePitchFieldId,
  BibleQuestionId,
  BibleTermEdit,
  BibleTermId,
  Timestamp,
  UserId,
} from '@folio/contracts'
import {
  bibleEntryId as brandBibleEntryId,
  bibleFactId as brandBibleFactId,
  biblePitchFieldId as brandBiblePitchFieldId,
  bibleQuestionId as brandBibleQuestionId,
  bibleTermId as brandBibleTermId,
} from '@folio/contracts'
import type { BibleEntryKind, BibleEntryStatus, BibleSection, NodeId } from '@folio/script'
import { BIBLE_SECTIONS, PITCH_FIELD_KEYS, PITCH_TITLE } from '@folio/script'
import { and, asc, eq, sql } from 'drizzle-orm'

import {
  bibleEntries,
  bibleFacts,
  biblePitchFields,
  bibleQuestions,
  bibleTerms,
  sceneDerivations,
  users,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * The Bible route's reads, and every authored write it makes.
 *
 * ## Five authored tables, nothing derived
 *
 * `schema/bible.ts` says what each is. Nothing here writes a derived table
 * and nothing here reads a node's content: the glossary's use count and the
 * check view's excerpts are the pure core's over `readProjectScreenplayNodes`
 * (`documents.ts`), run by the route's loader, never stored.
 *
 * ## `listCanonFacts` is the context gate, and it is a WHERE clause
 *
 * The brief: "Entry status is a permission, not a label. `canon` is checked
 * against every draft and readable by lenses; `draft` is neither until
 * promoted; `retired` is kept for history and ignored. Enforce this
 * server-side in the context builder, not in the UI." `listCanonFacts` is
 * the one read that returns facts by that permission - `status = 'canon'`
 * in SQL, the rule `@folio/script`'s `isReadableByLenses` states and tests -
 * and it is the read a context builder may use. A lens that reads
 * `listBibleEntries` instead has read a draft, and that is the leak the
 * brief names; the function's name is the reminder and the docs are the
 * rule. The route's check view reads the same function, then drops the
 * conflicts whose scene has left the draft (`openConflicts`).
 *
 * ## Cites and conflicts are ids the caller resolves
 *
 * `bible_facts.cites` and `conflict_scene_node_id` have no foreign key
 * (`schema/bible.ts`). The reads hand the ids back as stored; the route
 * resolves them against the present scenes and drops what it cannot find,
 * the `key_lines` rule.
 *
 * ## One or two statements per write
 *
 * None of these is on a keystroke path - each is a click - so the Script
 * save's discipline is kept without its heroics: an edit is one `UPDATE`,
 * a create takes its position from a subquery rather than a prior read,
 * and the Pitch's seven fields go in with one `INSERT`. Adding a child
 * row - a fact, a question, a field - reads its entry first, through the
 * scope: the foreign key would accept another project's entry id, and the
 * read is what refuses it.
 */

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export type BibleEntryRecord = {
  readonly id: BibleEntryId
  readonly section: BibleSection
  readonly kind: BibleEntryKind
  readonly status: BibleEntryStatus
  readonly title: string
  readonly lede: string | null
  readonly notes: string | null
  readonly position: number
  readonly updatedAt: Timestamp
}

const toEntry = (row: typeof bibleEntries.$inferSelect): BibleEntryRecord => ({
  id: brandBibleEntryId(row.id),
  section: row.section,
  kind: row.kind,
  status: row.status,
  title: row.title,
  lede: row.lede,
  notes: row.notes,
  position: row.position,
  updatedAt: stamp(row.updatedAt),
})

/** Section order as the brief lists it, for `ORDER BY`. */
const sectionRank = sql<number>`case ${bibleEntries.section} ${sql.join(
  BIBLE_SECTIONS.map((section, at) => sql`when ${sql.raw(`'${section}'`)} then ${sql.raw(String(at))}`),
  sql` `,
)} end`

/**
 * Every entry, in nav order: section, the Pitch first within Premise, then
 * the writer's position, then age.
 */
export const listBibleEntries = async (scope: ProjectScope): Promise<readonly BibleEntryRecord[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(bibleEntries)
    .where(scoped(scope, bibleEntries))
    .orderBy(
      sectionRank,
      sql`case ${bibleEntries.kind} when 'pitch' then 0 else 1 end`,
      asc(bibleEntries.position),
      asc(bibleEntries.createdAt),
      asc(bibleEntries.id),
    )
  return rows.map(toEntry)
}

export const readBibleEntry = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
): Promise<BibleEntryRecord | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(bibleEntries)
    .where(scoped(scope, bibleEntries, eq(bibleEntries.id, entryId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toEntry(row)
}

/** The entry a child row is about to hang off, through the scope. The tenancy check every add runs first. */
const ownedEntry = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
): Promise<{ readonly kind: BibleEntryKind } | null> => {
  const rows = await dbOf(scope)
    .select({ kind: bibleEntries.kind })
    .from(bibleEntries)
    .where(scoped(scope, bibleEntries, eq(bibleEntries.id, entryId)))
    .limit(1)
  return rows[0] ?? null
}

const nextPosition = (scope: ProjectScope, section: BibleSection) =>
  dbOf(scope)
    .select({ value: sql<number>`coalesce(max(${bibleEntries.position}) + 1, 0)` })
    .from(bibleEntries)
    .where(scoped(scope, bibleEntries, eq(bibleEntries.section, section)))

/** Create a rules entry at the end of its section. Draft, as every entry starts. */
export const createBibleEntry = async (scope: ProjectScope, create: BibleEntryCreate): Promise<BibleEntryId> => {
  const rows = await dbOf(scope)
    .insert(bibleEntries)
    .values({
      ...tenant(scope),
      section: create.section,
      kind: 'rules',
      title: create.title,
      position: sql`(${nextPosition(scope, create.section)})`,
    })
    .returning({ id: bibleEntries.id })
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a bible entry returned no row.')
  return brandBibleEntryId(row.id)
}

/**
 * Create the Pitch: one per project, in Premise, with the seven fields the
 * pure core names, empty. `ON CONFLICT DO NOTHING` on the partial unique
 * index makes a second one a `null`, not a duplicate and not a throw. Two
 * statements: the entry, then its fields.
 */
export const createPitch = async (scope: ProjectScope): Promise<BibleEntryId | null> => {
  const rows = await dbOf(scope)
    .insert(bibleEntries)
    .values({
      ...tenant(scope),
      section: 'premise',
      kind: 'pitch',
      title: PITCH_TITLE,
      position: sql`(${nextPosition(scope, 'premise')})`,
    })
    .onConflictDoNothing()
    .returning({ id: bibleEntries.id })
  const row = rows[0]
  if (row === undefined) return null
  await dbOf(scope)
    .insert(biblePitchFields)
    .values(PITCH_FIELD_KEYS.map((key, position) => ({ ...tenant(scope), entryId: row.id, position, key })))
  return brandBibleEntryId(row.id)
}

/** The entry's text. Returns whether a row was there to write. */
export const updateBibleEntry = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
  edit: BibleEntryEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(bibleEntries)
    .set({
      ...(edit.title === undefined ? {} : { title: edit.title }),
      ...(edit.lede === undefined ? {} : { lede: edit.lede === '' ? null : edit.lede }),
      ...(edit.notes === undefined ? {} : { notes: edit.notes === '' ? null : edit.notes }),
      updatedAt: new Date(),
    })
    .where(scoped(scope, bibleEntries, eq(bibleEntries.id, entryId)))
    .returning({ id: bibleEntries.id })
  return rows.length > 0
}

/** The gate's value. Promote, demote or retire; one statement. */
export const setBibleEntryStatus = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
  status: BibleEntryStatus,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(bibleEntries)
    .set({ status, updatedAt: new Date() })
    .where(scoped(scope, bibleEntries, eq(bibleEntries.id, entryId)))
    .returning({ id: bibleEntries.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export type BibleFactRecord = {
  readonly id: BibleFactId
  readonly entryId: BibleEntryId
  /** The entry's status, joined, so the gate can be applied without a second read. */
  readonly entryStatus: BibleEntryStatus
  readonly entryTitle: string
  readonly position: number
  readonly text: string
  /** As stored: heading node ids the caller resolves. */
  readonly cites: readonly NodeId[]
  readonly conflictSceneId: NodeId | null
  readonly conflictNote: string | null
}

const FACT_COLUMNS = {
  id: bibleFacts.id,
  entryId: bibleFacts.entryId,
  entryStatus: bibleEntries.status,
  entryTitle: bibleEntries.title,
  position: bibleFacts.position,
  text: bibleFacts.text,
  cites: bibleFacts.cites,
  conflictSceneNodeId: bibleFacts.conflictSceneNodeId,
  conflictNote: bibleFacts.conflictNote,
} as const

type FactRow = {
  readonly id: string
  readonly entryId: string
  readonly entryStatus: BibleEntryStatus
  readonly entryTitle: string
  readonly position: number
  readonly text: string
  readonly cites: readonly string[]
  readonly conflictSceneNodeId: string | null
  readonly conflictNote: string | null
}

const toFact = (row: FactRow): BibleFactRecord => ({
  id: brandBibleFactId(row.id),
  entryId: brandBibleEntryId(row.entryId),
  entryStatus: row.entryStatus,
  entryTitle: row.entryTitle,
  position: row.position,
  text: row.text,
  cites: row.cites as NodeId[],
  conflictSceneId: row.conflictSceneNodeId === null ? null : (row.conflictSceneNodeId as NodeId),
  conflictNote: row.conflictNote,
})

/** Every fact in the project with its entry's status, in entry order then position. */
export const listBibleFacts = async (scope: ProjectScope): Promise<readonly BibleFactRecord[]> => {
  const rows = await dbOf(scope)
    .select(FACT_COLUMNS)
    .from(bibleFacts)
    .innerJoin(bibleEntries, eq(bibleEntries.id, bibleFacts.entryId))
    .where(scoped(scope, bibleFacts))
    .orderBy(asc(bibleFacts.entryId), asc(bibleFacts.position), asc(bibleFacts.createdAt), asc(bibleFacts.id))
  return rows.map(toFact)
}

/**
 * **The first context gate.** The facts a lens may read and the draft is
 * checked against: those of canon entries, and no other. See the header.
 * The Pitch has no facts, so it never comes back here whatever its status.
 */
export const listCanonFacts = async (scope: ProjectScope): Promise<readonly BibleFactRecord[]> => {
  const rows = await dbOf(scope)
    .select(FACT_COLUMNS)
    .from(bibleFacts)
    .innerJoin(bibleEntries, and(eq(bibleEntries.id, bibleFacts.entryId), eq(bibleEntries.status, 'canon')))
    .where(scoped(scope, bibleFacts))
    .orderBy(asc(bibleFacts.entryId), asc(bibleFacts.position), asc(bibleFacts.createdAt), asc(bibleFacts.id))
  return rows.map(toFact)
}

/**
 * Add a fact at the end of its entry. Two statements: the entry is read
 * first, through the scope, so a fact can never hang off another project's
 * entry - the FK alone would not stop that - then the insert takes its
 * position from a subquery. Null when the entry is not here.
 */
export const addBibleFact = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
  edit: BibleFactEdit,
): Promise<BibleFactId | null> => {
  const owner = await ownedEntry(scope, entryId)
  if (owner === null) return null
  const next = dbOf(scope)
    .select({ value: sql<number>`coalesce(max(${bibleFacts.position}) + 1, 0)` })
    .from(bibleFacts)
    .where(scoped(scope, bibleFacts, eq(bibleFacts.entryId, entryId)))
  const rows = await dbOf(scope)
    .insert(bibleFacts)
    .values({
      ...tenant(scope),
      entryId,
      position: sql`(${next})`,
      text: edit.text,
      cites: [...edit.cites],
    })
    .returning({ id: bibleFacts.id })
  const row = rows[0]
  return row === undefined ? null : brandBibleFactId(row.id)
}

/** The fact's text and cites, whole. Returns whether a row was there to write. */
export const updateBibleFact = async (
  scope: ProjectScope,
  factId: BibleFactId,
  edit: BibleFactEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(bibleFacts)
    .set({ text: edit.text, cites: [...edit.cites], updatedAt: new Date() })
    .where(scoped(scope, bibleFacts, eq(bibleFacts.id, factId)))
    .returning({ id: bibleFacts.id })
  return rows.length > 0
}

/**
 * The check view's "Scene is right · update rule": the rule's new text,
 * and the conflict cleared in the same statement, because the rule now
 * agrees with the scene.
 */
export const rewriteBibleFactAndClearConflict = async (
  scope: ProjectScope,
  factId: BibleFactId,
  text: string,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(bibleFacts)
    .set({ text, conflictSceneNodeId: null, conflictNote: null, updatedAt: new Date() })
    .where(scoped(scope, bibleFacts, eq(bibleFacts.id, factId)))
    .returning({ id: bibleFacts.id })
  return rows.length > 0
}

export const deleteBibleFact = async (scope: ProjectScope, factId: BibleFactId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .delete(bibleFacts)
    .where(scoped(scope, bibleFacts, eq(bibleFacts.id, factId)))
    .returning({ id: bibleFacts.id })
  return rows.length > 0
}

/** Record a conflict on a fact: the scene and the note, together. Replaces any it carried. */
export const recordBibleConflict = async (
  scope: ProjectScope,
  factId: BibleFactId,
  edit: BibleConflictEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(bibleFacts)
    .set({ conflictSceneNodeId: edit.sceneNodeId, conflictNote: edit.note, updatedAt: new Date() })
    .where(scoped(scope, bibleFacts, eq(bibleFacts.id, factId)))
    .returning({ id: bibleFacts.id })
  return rows.length > 0
}

/** Decide a conflict: it leaves the fact. "Rule is right" and "Both fine" both end here. */
export const clearBibleConflict = async (scope: ProjectScope, factId: BibleFactId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(bibleFacts)
    .set({ conflictSceneNodeId: null, conflictNote: null, updatedAt: new Date() })
    .where(scoped(scope, bibleFacts, eq(bibleFacts.id, factId)))
    .returning({ id: bibleFacts.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Open questions
// ---------------------------------------------------------------------------

export type BibleQuestionRecord = {
  readonly id: BibleQuestionId
  readonly entryId: BibleEntryId
  readonly text: string
  readonly authorId: UserId
  readonly authorName: string
  readonly resolved: boolean
}

/** One entry's questions with each author's display name, in the writer's order. */
export const listBibleQuestions = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
): Promise<readonly BibleQuestionRecord[]> => {
  const rows = await dbOf(scope)
    .select({
      id: bibleQuestions.id,
      entryId: bibleQuestions.entryId,
      text: bibleQuestions.text,
      authorId: bibleQuestions.authorId,
      authorName: users.displayName,
      resolved: bibleQuestions.resolved,
    })
    .from(bibleQuestions)
    .innerJoin(users, eq(users.id, bibleQuestions.authorId))
    .where(scoped(scope, bibleQuestions, eq(bibleQuestions.entryId, entryId)))
    .orderBy(asc(bibleQuestions.position), asc(bibleQuestions.createdAt), asc(bibleQuestions.id))
  return rows.map((row) => ({
    id: brandBibleQuestionId(row.id),
    entryId: brandBibleEntryId(row.entryId),
    text: row.text,
    authorId: row.authorId as UserId,
    authorName: row.authorName,
    resolved: row.resolved,
  }))
}

/** Ask a question on an entry, as the scope's actor. Null when the entry is not here. */
export const addBibleQuestion = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
  text: string,
): Promise<BibleQuestionId | null> => {
  const author = scope.actor
  if (author === null) throw new Error('Folio: a bible question needs an author. The worker cannot ask one.')
  const owner = await ownedEntry(scope, entryId)
  if (owner === null) return null
  const next = dbOf(scope)
    .select({ value: sql<number>`coalesce(max(${bibleQuestions.position}) + 1, 0)` })
    .from(bibleQuestions)
    .where(scoped(scope, bibleQuestions, eq(bibleQuestions.entryId, entryId)))
  const rows = await dbOf(scope)
    .insert(bibleQuestions)
    .values({ ...tenant(scope), entryId, position: sql`(${next})`, text, authorId: author })
    .returning({ id: bibleQuestions.id })
  const row = rows[0]
  return row === undefined ? null : brandBibleQuestionId(row.id)
}

export const setBibleQuestionResolved = async (
  scope: ProjectScope,
  questionId: BibleQuestionId,
  resolved: boolean,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(bibleQuestions)
    .set({ resolved, updatedAt: new Date() })
    .where(scoped(scope, bibleQuestions, eq(bibleQuestions.id, questionId)))
    .returning({ id: bibleQuestions.id })
  return rows.length > 0
}

export const deleteBibleQuestion = async (scope: ProjectScope, questionId: BibleQuestionId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .delete(bibleQuestions)
    .where(scoped(scope, bibleQuestions, eq(bibleQuestions.id, questionId)))
    .returning({ id: bibleQuestions.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// The Pitch's fields
// ---------------------------------------------------------------------------

export type BiblePitchFieldRecord = {
  readonly id: BiblePitchFieldId
  readonly entryId: BibleEntryId
  readonly key: string
  readonly value: string
}

export const listBiblePitchFields = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
): Promise<readonly BiblePitchFieldRecord[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(biblePitchFields)
    .where(scoped(scope, biblePitchFields, eq(biblePitchFields.entryId, entryId)))
    .orderBy(asc(biblePitchFields.position), asc(biblePitchFields.createdAt), asc(biblePitchFields.id))
  return rows.map((row) => ({
    id: brandBiblePitchFieldId(row.id),
    entryId: brandBibleEntryId(row.entryId),
    key: row.key,
    value: row.value,
  }))
}

/** Add a field at the end of the Pitch. Null when the entry is not here or is not the Pitch. */
export const addBiblePitchField = async (
  scope: ProjectScope,
  entryId: BibleEntryId,
  edit: BiblePitchFieldEdit,
): Promise<BiblePitchFieldId | null> => {
  const owner = await ownedEntry(scope, entryId)
  if (owner === null || owner.kind !== 'pitch') return null
  const next = dbOf(scope)
    .select({ value: sql<number>`coalesce(max(${biblePitchFields.position}) + 1, 0)` })
    .from(biblePitchFields)
    .where(scoped(scope, biblePitchFields, eq(biblePitchFields.entryId, entryId)))
  const rows = await dbOf(scope)
    .insert(biblePitchFields)
    .values({ ...tenant(scope), entryId, position: sql`(${next})`, key: edit.key, value: edit.value })
    .returning({ id: biblePitchFields.id })
  const row = rows[0]
  return row === undefined ? null : brandBiblePitchFieldId(row.id)
}

export const updateBiblePitchField = async (
  scope: ProjectScope,
  fieldId: BiblePitchFieldId,
  edit: BiblePitchFieldEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(biblePitchFields)
    .set({ key: edit.key, value: edit.value, updatedAt: new Date() })
    .where(scoped(scope, biblePitchFields, eq(biblePitchFields.id, fieldId)))
    .returning({ id: biblePitchFields.id })
  return rows.length > 0
}

export const deleteBiblePitchField = async (scope: ProjectScope, fieldId: BiblePitchFieldId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .delete(biblePitchFields)
    .where(scoped(scope, biblePitchFields, eq(biblePitchFields.id, fieldId)))
    .returning({ id: biblePitchFields.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// The glossary
// ---------------------------------------------------------------------------

export type BibleTermRecord = {
  readonly id: BibleTermId
  readonly term: string
  readonly definition: string
}

/** Every term, alphabetically, case-folded. */
export const listBibleTerms = async (scope: ProjectScope): Promise<readonly BibleTermRecord[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(bibleTerms)
    .where(scoped(scope, bibleTerms))
    .orderBy(sql`lower(${bibleTerms.term})`, asc(bibleTerms.id))
  return rows.map((row) => ({ id: brandBibleTermId(row.id), term: row.term, definition: row.definition }))
}

/** Add a term. Null when the spelling is already in the glossary, case-folded. */
export const addBibleTerm = async (scope: ProjectScope, edit: BibleTermEdit): Promise<BibleTermId | null> => {
  const rows = await dbOf(scope)
    .insert(bibleTerms)
    .values({ ...tenant(scope), term: edit.term, definition: edit.definition })
    .onConflictDoNothing()
    .returning({ id: bibleTerms.id })
  const row = rows[0]
  return row === undefined ? null : brandBibleTermId(row.id)
}

/**
 * Rewrite a term. `taken` when the new spelling is another term's,
 * case-folded; `missing` when the id is not here; `updated` otherwise.
 * The conflict is caught by the unique index rather than read first.
 */
export const updateBibleTerm = async (
  scope: ProjectScope,
  termId: BibleTermId,
  edit: BibleTermEdit,
): Promise<'updated' | 'taken' | 'missing'> => {
  try {
    const rows = await dbOf(scope)
      .update(bibleTerms)
      .set({ term: edit.term, definition: edit.definition, updatedAt: new Date() })
      .where(scoped(scope, bibleTerms, eq(bibleTerms.id, termId)))
      .returning({ id: bibleTerms.id })
    return rows.length > 0 ? 'updated' : 'missing'
  } catch (cause) {
    if (isUniqueViolation(cause)) return 'taken'
    throw cause
  }
}

/** Postgres `unique_violation`, however the driver wraps it. */
const isUniqueViolation = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505'

export const deleteBibleTerm = async (scope: ProjectScope, termId: BibleTermId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .delete(bibleTerms)
    .where(scoped(scope, bibleTerms, eq(bibleTerms.id, termId)))
    .returning({ id: bibleTerms.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * How many rules the draft contradicts, as the rail badge counts them:
 * facts of canon entries carrying a conflict whose scene is present in the
 * derived cache. Called from `workspace.ts`'s `readRailBadges`; the same
 * three conditions `openConflicts` applies, in SQL, because the badge must
 * not read every fact on every render.
 */
export const countOpenCanonConflicts = async (scope: ProjectScope): Promise<number> => {
  const rows = await dbOf(scope).execute(sql`
    select count(*)::int as n
    from ${bibleFacts} f
    join ${bibleEntries} e on e.id = f.entry_id
    join ${sceneDerivations} s on s.scene_node_id = f.conflict_scene_node_id
    where f.project_id = ${scope.projectId}
      and e.status = 'canon'
      and s.presence = 'present'
  `)
  const row = rows[0] as { readonly n: number } | undefined
  return row?.n ?? 0
}
