import type { Timestamp } from '@folio/contracts'
import type { DocumentId, NodeId } from '@folio/script'

import type { SaveConflict } from '../script/result'

/**
 * What the Outline route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never a
 * throw across the boundary).
 */

export type SaveOutlineResult =
  | {
      readonly status: 'saved'
      /** The document written - created by this save when the client sent `documentId: null`. */
      readonly documentId: DocumentId
      readonly createdAt: Timestamp
      readonly updatedAt: Timestamp
      readonly conflict: SaveConflict | null
      readonly snapshotTaken: boolean
      /** Counted from the list as written: what the nav's Outline row will say. */
      readonly acts: number
    }
  | { readonly status: 'ids-unusable'; readonly ids: readonly NodeId[] }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }
