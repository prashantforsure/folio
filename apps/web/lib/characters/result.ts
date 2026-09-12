import type { ArcTurnId, SceneRef } from '@folio/contracts'
import type { CharacterId, NodeId } from '@folio/script'

/**
 * What the Characters route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 */

export type Failure =
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type CreateResult = { readonly status: 'created'; readonly id: CharacterId } | Failure

export type SavedResult = { readonly status: 'saved' } | Failure

/** The rename's diff: how many cues were rewritten, across how many episodes. */
export type RenameResult =
  | { readonly status: 'renamed'; readonly cues: number; readonly episodes: number }
  | Failure

export type BindResult = { readonly status: 'bound' } | Failure

export type ArcTurnResult = { readonly status: 'saved'; readonly id: ArcTurnId } | Failure

/** One of the character's dialogue lines, for the key-line picker. */
export type DialogueLine = {
  readonly nodeId: NodeId
  readonly text: string
  readonly scene: SceneRef | null
}

export type DialogueResult = { readonly status: 'ok'; readonly lines: readonly DialogueLine[] } | Failure

export type MergeResult = { readonly status: 'merged'; readonly into: CharacterId } | Failure

export type DeleteResult = { readonly status: 'deleted' } | Failure

/** After a queue decision: how many rows still carry a proposal. The badge. */
export type ResolveResult = { readonly status: 'resolved'; readonly pending: number } | Failure

export type DeriveResult = { readonly status: 'derived'; readonly characters: number } | Failure
