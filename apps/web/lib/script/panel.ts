/**
 * What the right panel's Collaboration tab renders, shaped on the server.
 *
 * Ruled 2026-09-11: the tab ships **open comment threads and the revision
 * list, and no presence**. The bundle's Collaborators section - "Scene 12 ·
 * Dialogue", "idle 4m", live dots - is realtime by definition, and AGENTS.md
 * cuts realtime; it is not drawn. Nothing here is a placeholder: a thread is
 * a `comment_threads` row with its first `thread_comments` body, and a
 * revision is a `revisions` row.
 */

export type ThreadCard = {
  readonly id: string
  /** The author's display name. */
  readonly who: string
  /** `14:02` today, else the date. */
  readonly when: string
  /** `pg 3 · sc 2`, from the paged record; `detached` when the node is gone. */
  readonly at: string
  readonly body: string
}

export type RevisionRow = {
  readonly id: string
  /** `Rev. Blue — current`, `Rev. White — locked`, `Import — Standpipe.fdx`. */
  readonly name: string
  /** `since 2 Sep · 41 edits`. */
  readonly meta: string
}
