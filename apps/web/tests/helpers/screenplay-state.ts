import type { NodeId, ScreenplayNode, ScreenplayNodeType } from '@folio/script'
import { makeScreenplayNode, nodeId, typed } from '@folio/script'
import { getSchema } from '@tiptap/core'
import { history } from '@tiptap/pm/history'
import type { Schema } from '@tiptap/pm/model'
import type { Plugin, Transaction } from '@tiptap/pm/state'
import { EditorState, TextSelection } from '@tiptap/pm/state'

import { blockExtensions } from '../../app/(app)/app/project/[projectId]/_script/editor/extensions/blocks'
import { identityPlugin } from '../../app/(app)/app/project/[projectId]/_script/editor/extensions/identity'
import { Mention } from '../../app/(app)/app/project/[projectId]/_script/editor/extensions/mention'
import { ScreenplayDocument, ScreenplayText } from '../../app/(app)/app/project/[projectId]/_script/editor/extensions/schema'
import type { IdentityLog } from '../../lib/script/identity'
import { newIdentityLog } from '../../lib/script/identity'
import { idsOf, toDoc } from '../../lib/script/pm-model'

/**
 * A screenplay `EditorState` with no editor and no DOM: the schema the
 * extensions declare, the identity plugin, and history. What the keyboard
 * produces are transactions, and a transaction can be applied to a state
 * in Node - which is where these tests run, because jsdom does not load
 * on the local Node (`apps/web/CLAUDE.md`, trap 1).
 */

export const DOCUMENT_ID = 'doc-under-test'

export const screenplaySchema = (): Schema =>
  getSchema([
    ScreenplayDocument,
    ScreenplayText,
    ...blockExtensions({ documentId: DOCUMENT_ID }),
    Mention.configure({ labelFor: () => undefined }),
  ])

export const block = (id: string, type: ScreenplayNodeType, text: string): ScreenplayNode =>
  makeScreenplayNode(type, {
    id: nodeId(id),
    provenance: typed(),
    modifiers: [],
    content: text === '' ? [] : [{ kind: 'text', text }],
  })

export type Harness = {
  state: EditorState
  readonly schema: Schema
  readonly log: IdentityLog
  /** Apply a transaction built against the current state. */
  readonly run: (build: (tr: Transaction, state: EditorState) => void) => void
  /** The ids of every block, in order. */
  readonly ids: () => readonly string[]
  /** The position of `offset` characters into block `index`'s content. */
  readonly at: (index: number, offset: number) => number
  /** The position before block `index`. */
  readonly before: (index: number) => number
  readonly select: (index: number, offset: number) => void
}

export const harness = (nodes: readonly ScreenplayNode[], mint: () => NodeId, plugins: readonly Plugin[] = []): Harness => {
  const schema = screenplaySchema()
  const log = newIdentityLog()
  const doc = schema.nodeFromJSON(toDoc(nodes))
  const state = EditorState.create({ doc, plugins: [identityPlugin({ mint, log }), history(), ...plugins] })
  const out: Harness = {
    state,
    schema,
    log,
    run: (build) => {
      const tr = out.state.tr
      build(tr, out.state)
      out.state = out.state.apply(tr)
    },
    ids: () => idsOf(out.state.doc),
    before: (index) => {
      let pos = 0
      for (let at = 0; at < index; at += 1) pos += out.state.doc.child(at).nodeSize
      return pos
    },
    at: (index, offset) => out.before(index) + 1 + offset,
    select: (index, offset) => {
      out.run((tr) => {
        tr.setSelection(TextSelection.create(tr.doc, out.at(index, offset)))
      })
    },
  }
  return out
}

export const counterMint = (): (() => NodeId) => {
  let counter = 0
  return () => {
    counter += 1
    return nodeId(`m${String(counter)}`)
  }
}
