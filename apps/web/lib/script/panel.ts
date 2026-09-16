/**
 * What the Script route's threads and revisions look like once the server
 * has shaped them.
 *
 * ## Threads are inline since the redesign
 *
 * Ruled 2026-09-16: a comment thread is drawn *in the document*, as a card
 * under the block it anchors to - `docs/ui design/Route - Script v2.dc.html`
 * draws "Rukmini · 14:02 · not exported" between two blocks - with reply and
 * resolve on the card and creation from the block's `+` handle. `ThreadView`
 * is that card: every turn, not only the first, because a thread with
 * replies is drawn whole. `nodeId` is the anchor; the editor's decorations
 * plugin places the card after it.
 *
 * "not exported" is a constant, not a column: AGENTS.md, Export - "Comments
 * never enter an export" - and the exporter enforces it by never reading
 * the table.
 *
 * `ThreadCard` and `RevisionRow` are the earlier, one-line shapes the Outline
 * route's panel still draws; they stay until that route's own pass.
 */

export type ThreadTurn = {
  readonly id: string
  /** The author's display name, and two letters for the chip. */
  readonly who: string
  readonly initials: string
  /** `14:02` today, else the date. */
  readonly when: string
  readonly body: string
  readonly mine: boolean
}

export type ThreadView = {
  readonly id: string
  /** The node the thread hangs on - a screenplay node or an outline block. A thread whose node is gone is not drawn. */
  readonly nodeId: string
  readonly state: 'open' | 'resolved'
  readonly turns: readonly ThreadTurn[]
}

/**
 * The two node-anchored thread kinds a block's `+` handle can open. The
 * Script's blocks are `script_node`; the Outline's are `outline_block`
 * (since its v2 pass, 2026-09-16 - its older `beat` anchors still load).
 * `storyboard_shot` is a shot, not a node, and no editor opens one.
 */
export type ThreadNodeKind = 'script_node' | 'outline_block'

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

/** `14:02` for today, else `3 Sep`. The one clock the cards share. */
export const whenLabel = (iso: string, now = new Date()): string => {
  const when = new Date(iso)
  const sameDay = when.toDateString() === now.toDateString()
  return sameDay
    ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Two letters for a name chip: first letters of the first two words, else the first two letters. */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0)
  const first = words[0] ?? '?'
  const second = words[1]
  const pick = second === undefined ? [...first].slice(0, 2).join('') : `${[...first][0] ?? ''}${[...second][0] ?? ''}`
  return pick.toUpperCase()
}
