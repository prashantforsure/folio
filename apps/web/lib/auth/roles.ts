import type { MembershipRole } from '@folio/contracts'

/**
 * What a role lets somebody do - ADR 0003 **D2**, in one table.
 *
 * Until 2026-09-23 `memberships.role` was stored, shown in account settings
 * and enforced in exactly two places: share links and `purgeProject`. Every
 * other gate asked only whether a membership row existed, so a `reader`
 * invited by a share link could rename, merge, re-derive, upload, spend
 * credits and hard-delete an episode. `lib/script/gate.ts` said why - a
 * capability model invented in a commit would be a product decision taken by
 * accident - and ADR 0003 D2 is that decision taken on purpose. This file is
 * the decision; the gates are where it is applied.
 *
 * ## The three roles, in D2's own words
 *
 *   - **`reader`** - the read tools and comment threads. Nothing else.
 *   - **`writer`** - everything a reader can do, plus all authored edits,
 *     entity operations, production edits, paid generations, share links, and
 *     creating or renaming episodes.
 *   - **`owner`** - everything a writer can do, plus deleting episodes and
 *     editing, archiving, trashing, restoring or purging the project.
 *
 * The line between writer and owner is the line between *changing the work*
 * and *changing or destroying the container*.
 *
 * ## Why capabilities rather than a role at each call site
 *
 * Ninety-nine server actions pass one of these constants to their gate. Had
 * they passed `'writer'` directly, this table would be a comment: moving a
 * family of actions between roles would mean finding every one of them again,
 * and the tool registry (ADR 0003 D13, whose every tool declares a minimum
 * role) would have to repeat the mapping and drift from it. One table, two
 * readers.
 */

/** Ordered: `reader` < `writer` < `owner`. The index is the rank. */
export const ROLE_ORDER: readonly MembershipRole[] = ['reader', 'writer', 'owner']

const rankOf = (role: MembershipRole): number => {
  const rank = ROLE_ORDER.indexOf(role)
  // Unreachable while `MembershipRole` is the three above; a fourth role added
  // to the enum without a rank here must refuse rather than outrank an owner.
  return rank === -1 ? Number.POSITIVE_INFINITY : rank
}

/** Whether the role somebody holds reaches the minimum an action asks for. */
export const meetsRole = (held: MembershipRole, minimum: MembershipRole): boolean =>
  rankOf(held) >= rankOf(minimum)

/**
 * What a gate says when the membership is real and the role is not enough.
 *
 * Deliberately different from `REFUSED` ("That script could not be found"),
 * which is what a stranger gets: this person is a member, they are looking at
 * the project, and telling them it does not exist would be a lie they can
 * already see through. It names the reason and not the fix, because the fix is
 * a conversation with whoever invited them.
 */
export const ROLE_REFUSED = "Your role on this project doesn't allow that."

/**
 * The minimum role for each family of action. **The D2 matrix.**
 *
 * Every row here is a sentence of D2 above. A new action takes the row that
 * describes it rather than a role of its own; a new *row* is a change to D2,
 * which is an ADR, not a commit.
 */
export const ROLE = {
  /** Reading anything the project holds. The default, and what a gate asks for when nothing is said. */
  read: 'reader',
  /** Opening, replying to and resolving a comment thread. D2 names comment threads as a reader's. */
  comment: 'reader',
  /** Producing a file the caller could have clicked for themselves. Writes nothing (ADR 0003 D16). */
  export: 'reader',
  /** A per-person arrangement of a route - a `view_preferences` row is the reader's own. */
  preference: 'reader',
  /** The assistant panel: its chats, and one turn of it. Read-only by construction. */
  assistant: 'reader',

  /** Any authored edit to the script, the outline or a record's own fields. */
  authoredEdit: 'writer',
  /** Rename, merge, delete, bind, resolve - the entity operations, including the two sanctioned write-backs. */
  entityOperation: 'writer',
  /** Every Production authoring write, and the Storyboard's. */
  productionEdit: 'writer',
  /** Anything that reserves credits (`lib/production/generate.ts`). */
  paidGeneration: 'writer',
  /** Issuing and revoking a share link. Already enforced here before D2; unchanged by it. */
  shareLink: 'writer',
  /** Creating an episode, and renaming one. */
  episodeCreate: 'writer',
  /** A derivation pass over the whole project. Rewrites six derived tables and nothing authored. */
  derive: 'writer',

  /** Deleting an episode: a container of work, gone with everything keyed to it. */
  episodeDelete: 'owner',
  /** Renaming the project, its logline, archiving, trashing, restoring, purging. */
  projectAdmin: 'owner',
} as const satisfies Readonly<Record<string, MembershipRole>>

export type Capability = keyof typeof ROLE
