import { describe, expect, it } from 'vitest'

import type { FdxNode } from './fdx'
import { countFdxNodes, importFinalDraft } from './fdx'
import { serialiseFinalDraft } from './fdx-export'
import type { NodeId } from './ids'
import { characterId, nodeId } from './ids'
import type { ScreenplayNode, ScreenplayNodeType } from './node'
import { makeScreenplayNode } from './node'
import { typed } from './provenance'
import { featureLengthFdx } from './testing/fdx-corpus'
import { readFdxXml } from './testing/fdx-reader'

/**
 * Final Draft export: the importer's mirror.
 *
 * The contract is the Fountain writer's - `importFinalDraft(serialiseFinalDraft(nodes))`
 * is the identity on type, content and modifiers for every node not reported -
 * asserted on the feature-length corpus (real `.fdx`, through the importer,
 * out, and back in) and on the cases the mapping has to decide by hand.
 */

const ids = (count: number): readonly NodeId[] => Array.from({ length: count }, (_, index) => nodeId(`f${index}`))

const node = (id: string, type: ScreenplayNodeType, text: string, modifiers: readonly ('V.O.' | 'O.S.' | 'O.C.')[] = []): ScreenplayNode =>
  makeScreenplayNode(type, { id: nodeId(id), provenance: typed(), modifiers, content: text === '' ? [] : [{ kind: 'text', text }] })

const reimport = (root: FdxNode): readonly ScreenplayNode[] => {
  const imported = importFinalDraft(root, { freshIds: ids(countFdxNodes(root)) })
  if (!imported.ok) throw new Error(`import failed: ${JSON.stringify(imported.error)}`)
  return imported.value.nodes
}

const shape = (nodes: readonly ScreenplayNode[]) =>
  nodes.map((entry) => ({
    type: entry.type,
    content: entry.content,
    modifiers: entry.type === 'character' ? entry.modifiers : [],
  }))

const paragraphs = (root: FdxNode): readonly FdxNode[] =>
  root.children.find((child) => child.name === 'Content')?.children ?? []

describe('the round trip', () => {
  it('is the identity on the feature-length corpus, comments aside', () => {
    const first = reimport(readFdxXml(featureLengthFdx(60)))
    const exported = serialiseFinalDraft(first)
    const second = reimport(exported.root)
    const comparable = first.filter((entry) => entry.type !== 'comment')
    expect(shape(second)).toEqual(shape(comparable))
    expect(exported.omitted).toEqual(first.filter((entry) => entry.type === 'comment').map((entry) => entry.id))
    expect(exported.unrepresentable).toEqual([])
  })

  it('writes a speech as one Dialogue paragraph per line and the importer rejoins it', () => {
    const nodes = [node('a', 'character', 'MEERA', ['V.O.']), node('b', 'dialogue', 'First line.\nSecond line.\nThird.')]
    const exported = serialiseFinalDraft(nodes)
    const written = paragraphs(exported.root)
    expect(written.map((entry) => entry.attributes['Type'])).toEqual(['Character', 'Dialogue', 'Dialogue', 'Dialogue'])
    expect(written[0]?.children[0]?.text).toBe('MEERA (V.O.)')
    expect(shape(reimport(exported.root))).toEqual(shape(nodes))
  })
})

describe('what is never written', () => {
  it('no SceneProperties, no scene Number, no (MORE) or (CONT’D) - Final Draft paginates for itself', () => {
    const nodes = [node('a', 'scene', 'INT. CHAWL - DAY'), node('b', 'action', 'She waits.')]
    const written = paragraphs(serialiseFinalDraft(nodes).root)
    expect(written[0]?.attributes).toEqual({ Type: 'Scene Heading' })
    expect(written[0]?.children.map((child) => child.name)).toEqual(['Text'])
    expect(JSON.stringify(serialiseFinalDraft(nodes).root)).not.toMatch(/MORE|CONT|SceneProperties|Number/u)
  })

  it('a comment never enters an export', () => {
    const nodes = [node('a', 'action', 'Before.'), node('b', 'comment', 'a note to self'), node('c', 'action', 'After.')]
    const exported = serialiseFinalDraft(nodes)
    expect(paragraphs(exported.root)).toHaveLength(2)
    expect(exported.omitted).toEqual([nodeId('b')])
    expect(JSON.stringify(exported.root)).not.toContain('note to self')
  })
})

describe('what is reported', () => {
  it('a subtitle leaves as centred General and says so', () => {
    const exported = serialiseFinalDraft([node('a', 'subtitle', 'THREE YEARS LATER')])
    expect(paragraphs(exported.root)[0]?.attributes).toEqual({ Type: 'General', Alignment: 'Center' })
    expect(exported.unrepresentable).toEqual([{ id: nodeId('a'), reason: 'subtitle-as-general' }])
  })

  it('an empty block would not come back, and is reported', () => {
    const exported = serialiseFinalDraft([node('a', 'action', '')])
    expect(exported.unrepresentable).toEqual([{ id: nodeId('a'), reason: 'empty-block' }])
    expect(reimport(exported.root)).toHaveLength(0)
  })

  it('a mention is written as its label; one with no record is reported', () => {
    const withMention = makeScreenplayNode('action', {
      id: nodeId('a'),
      provenance: typed(),
      modifiers: [],
      content: [
        { kind: 'text', text: 'Wet washing. ' },
        { kind: 'mention', target: { entity: 'character', id: characterId('c1') } },
        { kind: 'text', text: ' moves.' },
      ],
    })
    const labelled = serialiseFinalDraft([withMention], {
      mentionLabels: [{ entity: 'character', id: characterId('c1'), label: 'MEERA' }],
    })
    expect(paragraphs(labelled.root)[0]?.children[0]?.text).toBe('Wet washing. MEERA moves.')
    expect(labelled.unrepresentable).toEqual([])

    const unlabelled = serialiseFinalDraft([withMention])
    expect(unlabelled.unrepresentable).toEqual([
      { id: nodeId('a'), reason: 'unresolved-mention', mention: { entity: 'character', id: 'c1' } },
    ])
  })
})
