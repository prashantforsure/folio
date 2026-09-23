import { runId } from '@folio/script'
import type { OutlineNode, ScreenplayNode } from '@folio/script'
import { byAgent, makeOutlineNode, makeScreenplayNode, nodeId, text, typed } from '@folio/script'
import { Editor } from '@tiptap/core'
import { undo } from '@tiptap/pm/history'
import { afterEach, describe, expect, it } from 'vitest'

import { blockExtensions as outlineBlocks } from '../app/(app)/app/project/[projectId]/_outline/editor/extensions/blocks'
import { OutlineIdentity } from '../app/(app)/app/project/[projectId]/_outline/editor/extensions/identity'
import { OutlineDocument, OutlineText } from '../app/(app)/app/project/[projectId]/_outline/editor/extensions/schema'
import { blockExtensions as scriptBlocks } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/blocks'
import { ScreenplayIdentity } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/identity'
import { ScreenplayKeymap } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/keymap'
import { Mention } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/mention'
import { ScreenplayDocument, ScreenplayText } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/schema'
import { editorFor, openDocuments, registerEditor } from '../lib/agent/editor-channel'
import { applyInOutlineEditor } from '../lib/outline/apply-ops'
import { fromDoc as outlineFromDoc, toDoc as outlineToDoc } from '../lib/outline/pm-model'
import { applyInScriptEditor } from '../lib/script/apply-ops'
import { mintNodeId, newIdentityLog } from '../lib/script/identity'
import { fromDoc, toDoc } from '../lib/script/pm-model'

/**
 * D10 path A in a real editor - roadmap task 3.4.
 *
 * A headless Tiptap editor with the Script route's own schema, blocks,
 * mention and identity extensions (the ones that decide what a block is and
 * what id it carries). Held here: the agent's operations land as **one**
 * transaction - one undo takes them all back; the new blocks carry the ids
 * minted when the proposal was written, not ids the identity plugin minted
 * over them, and the run's provenance; the rest of the document is untouched;
 * and operations that no longer apply to what is on screen dispatch nothing.
 */

const RUN = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'
const id = (n: number) => nodeId(`00000000-0000-4000-9000-${String(n).padStart(12, '0')}`)
const line = (n: number, type: ScreenplayNode['type'], words: string): ScreenplayNode => makeScreenplayNode(type, { id: id(n), provenance: typed(), content: [text(words)], modifiers: [] })
const SCRIPT = [line(1, 'scene', 'INT. WARD - NIGHT'), line(2, 'action', 'The ward is quiet.'), line(3, 'character', 'MEERA'), line(4, 'dialogue', 'You came back.')]

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

const scriptEditor = (nodes: readonly ScreenplayNode[]): Editor => {
  const editor = new Editor({
    extensions: [
      ScreenplayDocument,
      ScreenplayText,
      ...scriptBlocks({ documentId: 'doc' }),
      Mention.configure({ labelFor: () => undefined }),
      ScreenplayIdentity.configure({ mint: mintNodeId, log: newIdentityLog() }),
      // The route's keymap carries its undo history.
      ScreenplayKeymap,
    ],
    content: toDoc(nodes),
  })
  editors.push(editor)
  return editor
}

const read = (editor: Editor): readonly ScreenplayNode[] => {
  const result = fromDoc(editor.state.doc)
  if (!result.ok) throw new Error('the editor did not read')
  return result.value
}

const INSERT = [
  { op: 'insert_after', anchor: id(2), nodes: [{ id: id(100), type: 'action', content: [text('A monitor beeps.')], modifiers: [] }] },
  { op: 'replace_content', id: id(4), content: [text('You came back for me.')], modifiers: null },
]

describe('applyInScriptEditor', () => {
  it('applies the operations with the minted ids and the run, leaving the rest untouched', () => {
    const editor = scriptEditor(SCRIPT)
    expect(applyInScriptEditor(editor, INSERT, RUN)).toEqual({ ok: true })
    const nodes = read(editor)
    expect(nodes.map((node) => node.id)).toEqual([id(1), id(2), id(100), id(3), id(4)])
    expect(nodes[2]).toEqual(makeScreenplayNode('action', { id: id(100), provenance: byAgent(runId(RUN)), content: [text('A monitor beeps.')], modifiers: [] }))
    expect(nodes[4]?.provenance).toEqual(byAgent(runId(RUN)))
    expect(nodes.slice(0, 2)).toEqual(SCRIPT.slice(0, 2))
  })

  it('lands as one transaction - one undo takes the whole edit back', () => {
    const editor = scriptEditor(SCRIPT)
    let transactions = 0
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) transactions += 1
    })
    applyInScriptEditor(editor, INSERT, RUN)
    expect(transactions).toBe(1)
    undo(editor.state, editor.view.dispatch)
    expect(read(editor)).toEqual(SCRIPT)
  })

  it('dispatches nothing, and says stale, when the operations no longer apply to what is on screen', () => {
    const editor = scriptEditor(SCRIPT.filter((node) => node.id !== id(2)))
    const before = editor.state.doc
    const result = applyInScriptEditor(editor, INSERT, RUN)
    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.stale).toBe(true)
    expect(editor.state.doc).toBe(before)
  })

  it('refuses operations that do not read, without touching the document', () => {
    const editor = scriptEditor(SCRIPT)
    expect(applyInScriptEditor(editor, [{ op: 'rewrite_everything' }], RUN)).toEqual({ ok: false, message: 'The edit did not read.', stale: false })
  })
})

describe('applyInOutlineEditor', () => {
  it('applies an outline edit with the minted ids and the run', () => {
    const block = (n: number, type: OutlineNode['type'], words: string): OutlineNode => makeOutlineNode(type, { id: id(n), provenance: typed(), content: [text(words)] })
    const outline = [block(1, 'h1', 'Act One'), block(2, 'beat', 'Meera comes back')]
    const editor = new Editor({
      extensions: [OutlineDocument, OutlineText, ...outlineBlocks({ documentId: 'doc' }), Mention.configure({ labelFor: () => undefined }), OutlineIdentity.configure({ mint: mintNodeId, log: newIdentityLog() })],
      content: outlineToDoc(outline),
    })
    editors.push(editor)
    const result = applyInOutlineEditor(editor, [{ op: 'insert_after', anchor: id(2), nodes: [{ id: id(100), type: 'beat', content: [text('She finds the letter')], modifiers: [] }] }], RUN)
    expect(result).toEqual({ ok: true })
    const nodes = outlineFromDoc(editor.state.doc)
    expect(nodes.ok && nodes.value.map((node) => [node.id, node.provenance.source])).toEqual([
      [id(1), 'typed'],
      [id(2), 'typed'],
      [id(100), 'agent'],
    ])
  })
})

describe('the editor channel', () => {
  it('knows which documents are open, and forgets one when its editor unregisters', () => {
    const unregister = registerEditor('doc-1', { kind: 'screenplay', flush: () => Promise.resolve(), apply: () => ({ ok: true }) })
    expect(openDocuments()).toContain('doc-1')
    expect(editorFor('doc-1')?.kind).toBe('screenplay')
    unregister()
    expect(editorFor('doc-1')).toBeUndefined()
  })
})
