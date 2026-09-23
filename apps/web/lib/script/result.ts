import type { Timestamp, TitlePage } from '@folio/contracts'
import type { MeasurementRecord, MentionLabel, NodeId, PaginationError } from '@folio/script'

import type { ThreadView } from './panel'
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
      /**
       * The server's record - or null when the digest the client sent of
       * its own record matched, in which case what the client drew *is* the
       * server's answer and it keeps it (`digest.ts`).
       */
      readonly measurement: MeasureOutcome | null
      /** Null when this save did not derive; keep the last. */
      readonly stats: ScriptStats | null
      readonly labels: readonly MentionLabel[]
      readonly snapshotTaken: boolean
    }
  /** Ids the client minted that are tombstoned or already in use. Re-mint and retry. */
  | { readonly status: 'ids-unusable'; readonly ids: readonly NodeId[] }
  /**
   * The save carried an `expectedDigest` and the stored list has moved since.
   * **Nothing was written.** Distinct from `saved` with a `conflict`, which
   * means the opposite - the write landed over somebody else's.
   */
  | { readonly status: 'stale'; readonly conflict: SaveConflict }
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

/** A Final Draft export: the file text, and what the mapping left out or changed (`serialiseFinalDraft`). */
export type ExportScriptResult =
  | {
      readonly status: 'exported'
      readonly filename: string
      readonly xml: string
      /** Comment nodes, which never enter an export. */
      readonly omitted: number
      readonly subtitlesAsGeneral: number
      readonly unresolvedMentions: number
      readonly emptyBlocks: number
    }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }

/**
 * Fountain out. Plain text rather than XML, and a different set of caveats -
 * `serialiseFountain` reports what it had to force, not what it dropped,
 * because its promise is a round trip: parse what it writes and the same nodes
 * come back.
 */
export type ExportFountainResult =
  | {
      readonly status: 'exported'
      readonly filename: string
      readonly text: string
      /** Comment nodes, which never enter an export (AGENTS.md, Export). */
      readonly omitted: number
      /** Blocks the serialiser had to force so the parser reads them back as the same type. */
      readonly forced: number
    }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }

/**
 * A PDF (roadmap task 5.3): the file, as base64 for the wire - a server action
 * answers in JSON - its page count, and whether it was drawn from the stored
 * measurement or from one made now because the stored one was stale.
 */
export type ExportPdfResult =
  | {
      readonly status: 'exported'
      readonly filename: string
      readonly base64: string
      /** Script pages, covers not counted. */
      readonly pages: number
      /** `stored`: every section drawn from the measurement the editor wrote. `computed`: at least one measured here, now. */
      readonly source: 'stored' | 'computed'
    }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }

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

/** A thread action's answer: the card, whole, so the client replaces it in place. */
export type ThreadResult =
  | { readonly status: 'ok'; readonly thread: ThreadView }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
