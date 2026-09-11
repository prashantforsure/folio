import type { Timestamp, TitlePage } from '@folio/contracts'
import type { MeasurementRecord, MentionLabel, NodeId, PaginationError } from '@folio/script'

import type { ScriptStats } from './stats'

/**
 * What the Script route's server actions hand back.
 *
 * AGENTS.md, Conventions > Errors: "Server actions return a discriminated
 * result, never a bare throw across the boundary." Kept out of `actions.ts`
 * because a `'use server'` module may export only async functions.
 *
 * `MeasureOutcome` is the pagination result as the client receives it - the
 * record at the project's mode for the sheet, the paged record for the count,
 * or the engine's refusal (open decision 8, the A4 width) to show verbatim.
 */

export type MeasureOutcome =
  | { readonly ok: true; readonly record: MeasurementRecord; readonly paged: MeasurementRecord }
  | { readonly ok: false; readonly refusal: PaginationError }

/** Another save landed between this client's base version and its write. */
export type SaveConflict = {
  /** `documents.updated_at` the client thought it was writing over. */
  readonly expected: Timestamp
  /** What it actually was. The other writer's save is the one overwritten. */
  readonly found: Timestamp
}

export type SaveScriptResult =
  | {
      readonly status: 'saved'
      readonly updatedAt: Timestamp
      readonly conflict: SaveConflict | null
      readonly measurement: MeasureOutcome
      /** Null when this save did not derive; keep the last. */
      readonly stats: ScriptStats | null
      readonly labels: readonly MentionLabel[]
      readonly snapshotTaken: boolean
    }
  /** Ids the client minted that are tombstoned or already in use. Re-mint and retry. */
  | { readonly status: 'ids-unusable'; readonly ids: readonly NodeId[] }
  /** The payload did not read as a node list. Nothing was written. */
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }

export type ImportScriptResult =
  | {
      readonly status: 'imported'
      readonly nodes: number
      readonly stripped: number
      readonly headingsNotRecognised: number
      readonly unsupported: number
    }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'idle' }

export const IMPORT_IDLE: ImportScriptResult = { status: 'idle' }

export type SimpleResult =
  | { readonly status: 'done' }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type TitlePageResult =
  | { readonly status: 'saved'; readonly titlePage: TitlePage }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type MentionTargetResult =
  | { readonly status: 'created'; readonly label: MentionLabel }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
