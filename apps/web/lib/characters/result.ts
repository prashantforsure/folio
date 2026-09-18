import type { CharacterFinding, DraftField, SceneRef } from '@folio/contracts'
import type { CharacterId, CueRestore, ScreenplayNode } from '@folio/script'

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

/** `taken` carries whether the spelling is the holder's last, so the block can offer a move or a merge. */
export type BindResult =
  | { readonly status: 'bound' }
  | {
      readonly status: 'taken'
      readonly by: CharacterId
      readonly name: string
      readonly cue: string
      readonly last: boolean
    }
  | Failure

export type MoveResult =
  | { readonly status: 'moved' }
  | { readonly status: 'last'; readonly by: CharacterId; readonly name: string }
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

/** The sides: one part's nodes in script order, with the labels a mention run needs. */
export type SidesResult =
  | {
      readonly status: 'sides'
      readonly nodes: readonly ScreenplayNode[]
      readonly labels: readonly { readonly entity: 'character' | 'location'; readonly id: string; readonly label: string }[]
      /** The heading node ids as refs, so the modal can title each group. */
      readonly headings: readonly SceneRef[]
    }
  | Failure

// ---------------------------------------------------------------------------
// The model's actions (phase 4)
// ---------------------------------------------------------------------------

/**
 * A draft from the script, into an unsaved field. `nothing` is the honest
 * answer when the record is off the page or the model could cite nothing;
 * `shown` / `total` say how many of the character's scenes fitted the cap.
 */
export type DraftResult =
  | {
      readonly status: 'drafted'
      readonly field: DraftField
      readonly text: string
      readonly refs: readonly SceneRef[]
      readonly shown: number
      readonly total: number
    }
  | { readonly status: 'nothing'; readonly message: string }
  | Failure

/** After a check: the open findings as they now stand, and how many the model returned that did not quote the page. */
export type CheckResult =
  | {
      readonly status: 'checked'
      readonly findings: readonly CharacterFinding[]
      readonly dropped: number
      readonly shown: number
      readonly total: number
    }
  | { readonly status: 'nothing'; readonly message: string }
  | Failure

export type FindingResult = { readonly status: 'set'; readonly finding: CharacterFinding } | Failure
