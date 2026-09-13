// @vitest-environment node
import type { ScreenplayNode } from '@folio/script'
import { countFdxNodes, importFinalDraft, makeScreenplayNode, nodeId, serialiseFinalDraft, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { readFdx, writeFdx } from '../lib/script/fdx-adapter'

/**
 * The adapter both ways: what `writeFdx` writes, `readFdx` reads back into
 * the same tree, and the whole path - nodes, `serialiseFinalDraft`, XML
 * text, `readFdx`, `importFinalDraft` - is the identity the pure round trip
 * promises. This is the only test that touches `fast-xml-parser`.
 */

const node = (id: string, type: ScreenplayNode['type'], text: string): ScreenplayNode =>
  makeScreenplayNode(type, { id: nodeId(id), provenance: typed(), modifiers: [], content: [{ kind: 'text', text }] })

describe('writeFdx', () => {
  it('reads back as the tree it was given', () => {
    const nodes = [
      node('a', 'scene', 'INT. CHAWL - DAY'),
      node('b', 'action', 'Wet washing hangs the length of the corridor.'),
      node('c', 'character', 'MEERA'),
      node('d', 'dialogue', 'Line one.\nLine two.'),
      node('e', 'transition', 'CUT TO:'),
    ]
    const { root } = serialiseFinalDraft(nodes)
    const xml = writeFdx(root)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>')).toBe(true)
    expect(xml).toContain('<FinalDraft DocumentType="Script" Template="No" Version="5">')
    expect(xml).toContain('<Paragraph Type="Scene Heading">')

    const back = readFdx(xml)
    const document = back.children.find((child) => child.name === 'FinalDraft')
    expect(document?.attributes).toEqual(root.attributes)
    const imported = importFinalDraft(back, {
      freshIds: Array.from({ length: countFdxNodes(back) }, (_, index) => nodeId(`r${String(index)}`)),
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.value.nodes.map((entry) => ({ type: entry.type, content: entry.content }))).toEqual(
      nodes.map((entry) => ({ type: entry.type, content: entry.content })),
    )
  })

  it('escapes what XML must', () => {
    const xml = writeFdx(serialiseFinalDraft([node('a', 'action', 'Tom & Jerry <3 "quotes"')]).root)
    expect(xml).toContain('Tom &amp; Jerry &lt;3')
    const back = readFdx(xml)
    const imported = importFinalDraft(back, { freshIds: [nodeId('r0')] })
    expect(imported.ok && imported.value.nodes[0]?.content).toEqual([{ kind: 'text', text: 'Tom & Jerry <3 "quotes"' }])
  })
})
