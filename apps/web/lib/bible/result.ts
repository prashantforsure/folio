import type { BibleEntryId, BibleFactId, BiblePitchFieldId, BibleQuestionId, BibleTermId } from '@folio/contracts'

/**
 * What the Bible route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 */

export type Failure =
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type SavedResult = { readonly status: 'saved' } | Failure

export type EntryResult = { readonly status: 'created'; readonly id: BibleEntryId } | Failure

export type FactResult = { readonly status: 'saved'; readonly id: BibleFactId } | Failure

export type QuestionResult = { readonly status: 'saved'; readonly id: BibleQuestionId } | Failure

export type FieldResult = { readonly status: 'saved'; readonly id: BiblePitchFieldId } | Failure

export type TermResult = { readonly status: 'saved'; readonly id: BibleTermId } | Failure

/** After a conflict is decided: how many are still open. The badge. */
export type ConflictResult = { readonly status: 'decided'; readonly open: number } | Failure

/**
 * The check view's three buttons. `rule`: Rule is right · flag scene.
 * `scene`: Scene is right · update rule, with the rule's new text. `both`:
 * Both fine.
 */
export type ConflictDecision =
  | { readonly choice: 'rule' }
  | { readonly choice: 'scene'; readonly text: string }
  | { readonly choice: 'both' }
