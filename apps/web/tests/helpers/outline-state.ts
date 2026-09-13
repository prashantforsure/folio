import type { NodeId, OutlineNode, OutlineNodeType } from '@folio/script'
import { nodeId, typed } from '@folio/script'
import { getSchema } from '@tiptap/core'
import { history } from '@tiptap/pm/history'
import type { Schema } from '@tiptap/pm/model'
import type { Plugin, Transaction } from '@tiptap/pm/state'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'

import { blockExtensions } from '../../app/(app)/app/project/[projectId]/_outline/editor/extensions/blocks'
import { OutlineDocument, OutlineText } from '../../app/(app)/app/project/[projectId]/_outline/editor/extensions/schema'
import { identityPlugin } from '../../app/(app)/app/project/[projectId]/_script/editor/extensions/identity'
import { Mention } from '../../app/(app)/app/project/[projectId]/_script/editor/extensions/mention'
import { idsOf, toDoc } from '../../lib/outline/pm-model'
import type { IdentityLog } from '../../lib/script/identity'
import { newIdentityLog } from '../../lib/script/identity'

/**
 * An outline `EditorState` with no editor and no DOM: the schema the
 * extensions declare, the identity plugin, and history. `screenplay-state.ts`
 * for the other document, for the same reason - jsdom does not load on the
 * local Node (`apps/web/CLAUDE.md`, trap 1), so the editor tests are state
 * tests.
 */

export const DOCUMENT_ID = 'outline-under-test'

export const outlineSchema = (): Schema =>
  getSchema([OutlineDocument, OutlineText, ...blockExtensions({ documentId: DOCUMENT_ID }), Mention.configure({ labelFor: () => undefined })])

export const block = (id: string, type: OutlineNodeType, text: string): OutlineNode =>
  type === 'rule'
    ? { type, id: nodeId(id), provenance: typed() }
    : { type, id: nodeId(id), provenance: typed(), content: text === '' ? [] : [{ kind: 'text', text }] }

export type OutlineHarness = {
  state: EditorState
  readonly schema: Schema
  readonly log: IdentityLog
  readonly run: (build: (tr: Transaction, state: EditorState) => void) => void
  readonly ids: () => readonly string[]
  readonly types: () => readonly string[]
  /** The position of `offset` characters into block `index`'s content. */
  readonly at: (index: number, offset: number) => number
  /** The position before block `index`. */
  readonly before: (index: number) => number
  readonly select: (index: number, offset: number) => void
  /** A node selection on block `index` - how a rule is held. */
  readonly selectNode: (index: number) => void
}

export const harness = (nodes: readonly OutlineNode[], mint: () => NodeId, plugins: readonly Plugin[] = []): OutlineHarness => {
  const schema = outlineSchema()
  const log = newIdentityLog()
  const doc = schema.nodeFromJSON(toDoc(nodes))
  const state = EditorState.create({ doc, plugins: [identityPlugin({ mint, log }), history(), ...plugins] })
  const out: OutlineHarness = {
    state,
    schema,
    log,
    run: (build) => {
      const tr = out.state.tr
      build(tr, out.state)
      out.state = out.state.apply(tr)
    },
    ids: () => idsOf(out.state.doc),
    types: () => {
      const types: string[] = []
      out.state.doc.forEach((child) => {
        types.push(child.type.name)
      })
      return types
    },
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
    selectNode: (index) => {
      out.run((tr) => {
        tr.setSelection(NodeSelection.create(tr.doc, out.before(index)))
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
