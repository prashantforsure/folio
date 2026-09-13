import type { NodeId } from '@folio/script'
import { nodeId, typed } from '@folio/script'
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { AttrStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'

import type { IdentityLog } from '../../../../../../../../lib/script/identity'
import { blockAttrsOf, idsOf } from '../../../../../../../../lib/script/pm-model'

/**
 * Node identity, enforced at the one door every change uses.
 *
 * ADR 0001: the **head keeps its id on a split**, the **first node wins a
 * merge**, a **deleted id is retired and never reused**, a paste **keeps an
 * id that is absent from this document and mints one otherwise**. ProseMirror
 * does not know any of that - it copies attributes on a split and carries
 * them on a paste - so the rules are re-stated here, once, as a plugin that
 * appends to every transaction that changed the document's block structure.
 * Every keyboard path, paste, drop, undo and redo goes through
 * `applyTransaction`, so every one arrives here.
 *
 * ## What the appended transaction does
 *
 *   split      `keepOnSplit: false` gives the tail a `null` id (Tiptap's
 *              `splitBlock`) or a raw split copies the head's (ProseMirror's
 *              `split`). A `null` id and a *second* occurrence of an id are
 *              the same case: the block is minted a fresh id and `typed`
 *              provenance. The first occurrence - the head - is untouched.
 *   merge      ProseMirror keeps the first block's attributes when two
 *              join. The loser's id has left the document; it is logged as
 *              merged into the block that now holds its text.
 *   delete     An id that left without a merge is a retirement; nothing to
 *              do here - `retirementsSince` reads the difference at save.
 *   paste      `clipboard.ts` has already nulled every id that must be
 *              minted; whatever id survives is absent from this document
 *              and is kept. That is `pasteNodes`' rule, in DOM terms.
 *   rewrite    An `id` may never be changed on a block that has one. A
 *              transaction that tries - an `AttrStep`, or `setNodeMarkup`
 *              with a different id - has the old id put back. Only this
 *              plugin's own transactions (`identityKey` meta) may write one.
 *
 * ## Undo and redo
 *
 * An appended transaction joins the history event of the transaction it
 * was appended to. Undoing a split removes the tail and its minted id in
 * one step; redoing replays the split *and the minting*, so the tail comes
 * back with the same id rather than a new one - the id it was saved under.
 *
 * ## Cost
 *
 * A keystroke inside a block cannot change block identity, and it is not
 * walked: `isStructural` reads the steps and returns false for a replace
 * that stays inside one textblock with an inline slice. Anything else - a
 * split, a join, a paste of blocks, a type change - walks the document once,
 * three thousand attribute reads, on that transaction alone.
 */

export type IdentityOptions = {
  readonly mint: () => NodeId
  readonly log: IdentityLog
  /** Told the block ids in order whenever the block structure changed. */
  readonly onIds?: ((ids: readonly string[]) => void) | undefined
}

export type IdentityState = {
  /** Block ids in document order, as of the last structural transaction. */
  readonly ids: readonly string[]
}

export const identityKey = new PluginKey<IdentityState>('screenplayIdentity')

/**
 * Whether a transaction could have changed which blocks exist, in what
 * order, with what attributes. A replace inside one textblock whose slice
 * is closed and inline cannot; everything else is assumed to.
 */
export const isStructural = (tr: Transaction): boolean => {
  if (!tr.docChanged) return false
  for (let index = 0; index < tr.steps.length; index += 1) {
    const step = tr.steps[index]
    const before = tr.docs[index]
    if (step === undefined || before === undefined) return true
    if (!(step instanceof ReplaceStep)) return true
    if (step.slice.openStart !== 0 || step.slice.openEnd !== 0) return true
    let hasBlock = false
    step.slice.content.forEach((node) => {
      if (!node.isInline) hasBlock = true
    })
    if (hasBlock) return true
    const $from = before.resolve(step.from)
    const $to = before.resolve(step.to)
    if ($from.depth === 0 || !$from.sameParent($to)) return true
  }
  return false
}

type Rewrite = { readonly pos: number; readonly id: string }

/**
 * Every block whose `id` a transaction tried to change, with where the
 * block sits in the final document and the id it must have back.
 */
const rewrites = (transactions: readonly Transaction[]): readonly Rewrite[] => {
  const out: Rewrite[] = []
  transactions.forEach((tr, at) => {
    if (tr.getMeta(identityKey) === true) return
    tr.steps.forEach((step, index) => {
      const before = tr.docs[index]
      if (before === undefined) return
      let from: number | null = null
      let previous: string | null = null
      let next: unknown = null
      if (step instanceof AttrStep && step.attr === 'id') {
        const node = before.nodeAt(step.pos)
        if (node === null || !node.isBlock) return
        from = step.pos
        previous = blockAttrsOf(node).id
        next = step.value
      } else if (
        step instanceof ReplaceAroundStep &&
        step.insert === 1 &&
        step.gapFrom === step.from + 1 &&
        step.gapTo === step.to - 1 &&
        step.slice.openStart === 0 &&
        step.slice.openEnd === 0
      ) {
        // The shape `setNodeMarkup` produces: one node replaced around its own content.
        const old = before.nodeAt(step.from)
        const replacement = step.slice.content.firstChild
        if (old === null || replacement === null || !old.isBlock || !replacement.isBlock) return
        if (step.slice.content.childCount !== 1) return
        from = step.from
        previous = blockAttrsOf(old).id
        next = replacement.attrs['id']
      }
      if (from === null || previous === null || next === previous) return
      // A redo replays this plugin's own minting step without its meta: the
      // block's old id is then the head's, present twice, and changing it is
      // the rule being kept, not broken.
      let occurrences = 0
      before.forEach((candidate) => {
        if (blockAttrsOf(candidate).id === previous) occurrences += 1
      })
      if (occurrences > 1) return
      // Where that block is now: through the rest of this transaction, then the later ones.
      let pos = tr.mapping.slice(index + 1).map(from)
      for (let later = at + 1; later < transactions.length; later += 1) {
        const following = transactions[later]
        if (following === undefined) break
        pos = following.mapping.map(pos)
      }
      out.push({ pos, id: previous })
    })
  })
  return out
}

/** The nearest earlier id in `ids` (from `index - 1` down) that is still alive. */
const survivorBefore = (ids: readonly string[], index: number, alive: ReadonlySet<string>): number => {
  for (let at = index - 1; at >= 0; at -= 1) {
    const id = ids[at]
    if (id !== undefined && id !== '' && alive.has(id)) return at
  }
  return -1
}

/** The plugin itself, for a state-level test that has no editor. */
export const identityPlugin = ({ mint, log, onIds }: IdentityOptions): Plugin<IdentityState> =>
  new Plugin<IdentityState>({
    key: identityKey,
    state: {
      init: (_config, state) => ({ ids: idsOf(state.doc) }),
      apply: (tr, value, _old, state) => (isStructural(tr) ? { ids: idsOf(state.doc) } : value),
    },
    appendTransaction: (transactions, oldState, newState) => {
      if (!transactions.some(isStructural)) return null
      const tr = newState.tr
      let changed = false

      // A rewritten id is put back before anything else is decided.
      const restored = new Map<number, string>()
      for (const rewrite of rewrites(transactions)) {
        const node = newState.doc.nodeAt(rewrite.pos)
        if (node === null || !node.isBlock || blockAttrsOf(node).id === rewrite.id) continue
        restored.set(rewrite.pos, rewrite.id)
      }

      const seen = new Set<string>()
      const byId = new Map<string, ProseMirrorNode>()
      newState.doc.forEach((block, pos) => {
        const restoredId = restored.get(pos)
        const current = restoredId ?? blockAttrsOf(block).id
        if (current !== null && !seen.has(current)) {
          seen.add(current)
          byId.set(current, block)
          if (restoredId !== undefined) {
            tr.setNodeMarkup(pos, undefined, { ...block.attrs, id: restoredId })
            changed = true
          }
          return
        }
        // No id, or the second occurrence of one: the head keeps, this is minted.
        const fresh = mint()
        log.minted.add(fresh)
        seen.add(fresh)
        byId.set(fresh, block)
        tr.setNodeMarkup(pos, undefined, { ...block.attrs, id: fresh, provenance: typed(), origin: null })
        changed = true
      })

      // Ids that left: merged into the block that now holds their text, or retired.
      const previous = identityKey.getState(oldState)?.ids ?? idsOf(oldState.doc)
      previous.forEach((id, index) => {
        if (id === '' || seen.has(id)) return
        const at = survivorBefore(previous, index, seen)
        if (at === -1) return
        const survivorId = previous[at]
        const survivor = survivorId === undefined ? undefined : byId.get(survivorId)
        const before = oldState.doc.maybeChild(at)
        if (survivorId === undefined || survivor === undefined || before === null) return
        if (survivor.textContent !== before.textContent) log.mergedInto.set(id, survivorId)
      })

      if (!changed) return null
      tr.setMeta(identityKey, true)
      return tr
    },
    view: () => ({
      update: (view, previous) => {
        const ids = identityKey.getState(view.state)?.ids
        if (ids !== undefined && ids !== identityKey.getState(previous)?.ids) onIds?.(ids)
      },
    }),
  })

export const ScreenplayIdentity = Extension.create<IdentityOptions>({
  name: 'screenplayIdentity',
  addOptions() {
    return { mint: () => nodeId('unminted'), log: { mergedInto: new Map(), minted: new Set() }, onIds: undefined }
  },
  addProseMirrorPlugins() {
    return [identityPlugin(this.options)]
  },
})

/** The block ids in order, as the plugin last saw them. */
export const blockIds = (state: EditorState): readonly string[] => identityKey.getState(state)?.ids ?? idsOf(state.doc)
