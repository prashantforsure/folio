import type { Relationship } from '@folio/contracts'
import type { CharacterId, CueRestore } from '@folio/script'

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

/**
 * What one episode's rewrite read before the rename, so it can be taken
 * back by node id (`revertCueRewrites`): the episode's slug and the old
 * text per rewritten cue.
 */
export type RenameRestore = {
  readonly episode: string
  readonly restores: readonly CueRestore[]
}

/**
 * The rename's diff: how many cues were rewritten, across how many
 * episodes, and what it takes to undo it. `taken` is not a failure: the new
 * spelling is somebody else's cue, and the drawer offers the merge the
 * refusal used to name in prose.
 */
export type RenameResult =
  | {
      readonly status: 'renamed'
      readonly cues: number
      readonly episodes: number
      readonly previousName: string
      readonly name: string
      readonly restores: readonly RenameRestore[]
    }
  | { readonly status: 'taken'; readonly by: CharacterId; readonly name: string; readonly cue: string }
  | Failure

/** After `undoRename`: how many cues went back, and how many had changed since and were left. */
export type UndoRenameResult = { readonly status: 'undone'; readonly cues: number; readonly skipped: number } | Failure

/**
 * What a rename *would* do, before it does: the cues per episode, the bound
 * spellings that stay as they are (a rename rewrites the name's own cues
 * and leaves every other alias bound), and whether the new spelling is
 * already somebody's. A pure read; nothing is written.
 */
export type RenamePreview =
  | {
      readonly status: 'preview'
      readonly to: string
      readonly cues: number
      readonly episodes: readonly { readonly ordinal: number; readonly cues: number }[]
      readonly stays: readonly string[]
      readonly taken: { readonly by: CharacterId; readonly name: string } | null
    }
  | Failure

/** After an upload: the portrait's public URL, so the card can show it before the page re-reads. */
export type PortraitResult = { readonly status: 'saved'; readonly url: string | null } | Failure

export type MergeResult = { readonly status: 'merged'; readonly into: CharacterId } | Failure

export type DeleteResult = { readonly status: 'deleted' } | Failure

/** After a queue decision: how many rows still carry a proposal. The badge. */
export type ResolveResult = { readonly status: 'resolved'; readonly pending: number } | Failure

export type DeriveResult = { readonly status: 'derived'; readonly characters: number } | Failure

/** After a verdict on a pair of records: merged into the kept one, or marked different. */
export type PairResult = { readonly status: 'merged'; readonly into: CharacterId } | { readonly status: 'different' } | Failure

// ---------------------------------------------------------------------------
// The canvas and the graph (the fourth pass, 2026-09-20)
// ---------------------------------------------------------------------------

/** After a drop on the canvas: the position as written. */
export type PlaceResult = { readonly status: 'placed' } | Failure

/** After a relationship is written or deleted: the row as it now stands, or `gone`. */
export type RelationshipResult = { readonly status: 'saved'; readonly relationship: Relationship } | { readonly status: 'gone' } | Failure
