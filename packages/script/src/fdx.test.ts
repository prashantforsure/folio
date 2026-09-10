import { describe, expect, it } from 'vitest'

import type { FdxImport, FdxNode } from './fdx'
import { countFdxNodes, fdxNode, importFinalDraft } from './fdx'
import { countFountainNodes, parseFountain } from './fountain-parse'
import { serialiseFountain } from './fountain-serialise'
import type { NodeId } from './ids'
import { nodeId, runId } from './ids'
import type { ScreenplayNode, ScreenplayNodeType } from './node'
import { PAGINATION_FIELDS, SCREENPLAY_NODE_TYPES } from './node'
import { byAgent } from './provenance'
import { REPAGINATED_FDX, featureLengthFdx } from './testing/fdx-corpus'
import { readFdxXml } from './testing/fdx-reader'

/**
 * Final Draft import.
 *
 * AGENTS.md calls `.fdx` the front door, and onboarding's primary path is
 * importing an existing Final Draft file, so the two claims asserted hardest
 * here are the two the brief names: zero doubled continueds, and zero silent
 * scenes. Everything else is a count in support of one of them.
 *
 * The corpus is real `.fdx` text read by `testing/fdx-reader.ts`. The shipped
 * path is `fast-xml-parser` in `apps/web` and `apps/worker` producing the same
 * `FdxNode` tree - see the adapter note in `fdx.ts`.
 */

const ids = (count: number): readonly NodeId[] =>
  Array.from({ length: count }, (_, index) => nodeId(`f${index}`))

const tree = (xml: string): FdxNode => readFdxXml(xml)

const importOrThrow = (xml: string): FdxImport => {
  const root = tree(xml)
  const imported = importFinalDraft(root, { freshIds: ids(countFdxNodes(root)) })
  if (!imported.ok) throw new Error(`import failed: ${JSON.stringify(imported.error)}`)
  return imported.value
}

const textOf = (node: ScreenplayNode): string =>
  node.content.map((run) => (run.kind === 'text' ? run.text : '<mention>')).join('')

const summarise = (node: ScreenplayNode): unknown => ({
  type: node.type,
  text: textOf(node),
  ...(node.type === 'character' ? { modifiers: node.modifiers } : {}),
})

const CONT_D = /\(\s*cont\s*['’ʹʼ´`′.]?\s*d\.?\s*\)/iu
const MORE = /\(\s*more\s*\.{0,3}\s*\)/iu

// ---------------------------------------------------------------------------
// The tree contract
// ---------------------------------------------------------------------------

describe('the tree it takes', () => {
  it('refuses anything that is not a Final Draft document', () => {
    expect(importFinalDraft(fdxNode('html'), { freshIds: [] })).toEqual({
      ok: false,
      error: { kind: 'not-a-final-draft-document', received: 'html' },
    })
  })

  it('refuses a Final Draft document with no Content', () => {
    expect(importFinalDraft(fdxNode('FinalDraft'), { freshIds: [] })).toEqual({
      ok: false,
      error: { kind: 'no-content' },
    })
  })

  it('finds FinalDraft whether it is the root or wrapped by the adapter', () => {
    const wrapped = fdxNode('#document', {
      children: [fdxNode('FinalDraft', { children: [fdxNode('Content')] })],
    })
    const imported = importFinalDraft(wrapped, { freshIds: [] })
    expect(imported.ok && imported.value.nodes).toEqual([])
  })

  it('cannot mint an id, and says how many it wanted', () => {
    const root = tree(REPAGINATED_FDX)
    const needed = countFdxNodes(root)
    expect(needed).toBeGreaterThan(0)
    expect(importFinalDraft(root, { freshIds: ids(needed - 1) })).toEqual({
      ok: false,
      error: { kind: 'not-enough-ids', needed, supplied: needed - 1 },
    })
  })

  it('refuses a duplicate id, which would break the comment join', () => {
    const root = tree(REPAGINATED_FDX)
    const supplied = [...ids(countFdxNodes(root) - 1), nodeId('f0')]
    expect(importFinalDraft(root, { freshIds: supplied })).toEqual({
      ok: false,
      error: { kind: 'duplicate-id', id: 'f0' },
    })
  })

  it('carries the provenance it was given', () => {
    const root = tree(REPAGINATED_FDX)
    const imported = importFinalDraft(root, {
      freshIds: ids(countFdxNodes(root)),
      provenance: byAgent(runId('run_7')),
    })
    expect(imported.ok && imported.value.nodes[0]?.provenance).toEqual({
      source: 'agent',
      runId: 'run_7',
    })
  })
})

// ---------------------------------------------------------------------------
// Paragraph by paragraph
// ---------------------------------------------------------------------------

/** A minimal document around a handful of paragraphs. */
const document = (...paragraphs: readonly string[]): string =>
  ['<FinalDraft>', '<Content>', ...paragraphs, '</Content>', '</FinalDraft>'].join('\n')

describe('reading a paragraph', () => {
  it('concatenates every Text run and ignores the file indentation', () => {
    const imported = importOrThrow(
      document(
        '  <Paragraph Type="Action">',
        '    <Text Style="Bold">Rain </Text>',
        '    <Text>on the window.</Text>',
        '  </Paragraph>',
      ),
    )
    // The style is lost: `InlineRun` has no mark. Flagged in the report.
    expect(imported.nodes.map(summarise)).toEqual([
      { type: 'action', text: 'Rain on the window.' },
    ])
  })

  it('treats a paragraph with no Type as General, and says it coerced it', () => {
    const imported = importOrThrow(document('<Paragraph><Text>Untyped.</Text></Paragraph>'))
    expect(imported.nodes.map(summarise)).toEqual([{ type: 'action', text: 'Untyped.' }])
    expect(imported.coerced.map((entry) => entry.from)).toEqual(['General'])
  })

  it.each([
    ['End of Act', 'act-structure'],
    ['Act Break', 'act-structure'],
    ['Cast List', 'cast-list'],
  ])('drops %s as %s', (type, kind) => {
    const imported = importOrThrow(document(`<Paragraph Type="${type}"><Text>x</Text></Paragraph>`))
    expect(imported.nodes).toEqual([])
    expect(imported.unsupported.map((entry) => entry.kind)).toEqual([kind])
  })

  it('strips the dual-dialogue caret off a cue and reports it', () => {
    const imported = importOrThrow(
      document(
        '<Paragraph Type="Character"><Text>MEERA ^</Text></Paragraph>',
        '<Paragraph Type="Dialogue"><Text>At the same time.</Text></Paragraph>',
      ),
    )
    expect(imported.nodes.map(summarise)).toEqual([
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'dialogue', text: 'At the same time.' },
    ])
    expect(imported.unsupported.map((entry) => entry.kind)).toEqual(['dual-dialogue'])
  })

  it('a note on an otherwise empty paragraph is still a Comment', () => {
    const imported = importOrThrow(
      document(
        '<Paragraph Type="Action"><ScriptNote><Paragraph><Text>a floating note</Text></Paragraph></ScriptNote></Paragraph>',
        '<Paragraph Type="Dialogue"><Text>Orphaned, but kept.</Text></Paragraph>',
      ),
    )
    expect(imported.nodes.map(summarise)).toEqual([
      { type: 'comment', text: 'a floating note' },
      { type: 'dialogue', text: 'Orphaned, but kept.' },
    ])
  })

  it('refuses an empty id and hands back the ids it did not need', () => {
    const root = tree(document('<Paragraph Type="Action"><Text>One.</Text></Paragraph>'))
    expect(importFinalDraft(root, { freshIds: [nodeId('')] })).toEqual({
      ok: false,
      error: { kind: 'empty-id', index: 0 },
    })
    const spare = importFinalDraft(root, { freshIds: ids(3) })
    expect(spare.ok && spare.value.unusedIds).toEqual([nodeId('f1'), nodeId('f2')])
  })
})

// ---------------------------------------------------------------------------
// A repaginated export, node for node
// ---------------------------------------------------------------------------

describe('a repaginated Final Draft export', () => {
  const imported = importOrThrow(REPAGINATED_FDX)

  it('imports to exactly the node list the writer authored', () => {
    expect(imported.nodes.map(summarise)).toEqual([
      { type: 'scene', text: 'INT. MEERAS FLAT - NIGHT' },
      { type: 'action', text: 'Rain on the window. MEERA counts notes onto the table.' },
      // A ScriptNote is a Comment node, anchored after the paragraph it was in.
      { type: 'comment', text: 'is the rain too much' },
      { type: 'character', text: 'MEERA', modifiers: [] },
      {
        type: 'dialogue',
        // The page split collapsed: one cue, one speech, no repeated cue.
        text: 'You said the fifteenth. It is the twenty-first.\nI am not asking for the whole of it.',
      },
      { type: 'action', text: 'The LANDLORD does not sit down.' },
      // Speaker continued after an action line: the cue is real, the (CONT’D) is not.
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'dialogue', text: 'Sit down.' },
      { type: 'character', text: 'LANDLORD', modifiers: [] },
      { type: 'paren', text: '(not looking up)' },
      { type: 'dialogue', text: 'I have twelve rooms in this building.' },
      // Authored (V.O.) kept, generated (CONT’D) removed, from the one cue.
      { type: 'character', text: 'MEERA', modifiers: ['V.O.'] },
      { type: 'dialogue', text: 'He had twelve rooms and no time at all.' },
      // Final Draft declared this a heading, so it is a Scene - and reported.
      { type: 'scene', text: 'INTERCUT - PHONE CALL' },
      { type: 'action', text: 'ANGLE ON THE TELEPHONE' },
      { type: 'action', text: 'A note to the production office.' },
      { type: 'character', text: 'ARJUN', modifiers: [] },
      { type: 'dialogue', text: 'At the same time.' },
      { type: 'character', text: 'KAMLA', modifiers: [] },
      { type: 'dialogue', text: 'And so does she.' },
      { type: 'transition', text: 'CUT TO:' },
    ])
  })

  it('counts the generated text it removed', () => {
    expect(imported.stripped.map((entry) => entry.kind)).toEqual([
      'more',
      'cont-d',
      'cont-d',
      'cont-d',
    ])
    expect(imported.rejoinedContinuations).toHaveLength(1)
    expect(imported.rejoinedContinuations[0]?.cue).toBe("MEERA (CONT'D)")
    const spellings = new Set(imported.stripped.map((entry) => entry.text))
    expect(spellings.has("(CONT'D)")).toBe(true)
    expect(spellings.has('(CONT’D)')).toBe(true)
  })

  it('discards the page number and the eighths, and counts them', () => {
    expect(imported.discarded).toEqual([
      { field: 'page', value: '12', id: 'f0' },
      { field: 'length', value: '3/8', id: 'f0' },
      { field: 'scene-number', value: '24', id: 'f0' },
      { field: 'page', value: '13', id: 'f13' },
      { field: 'length', value: '1/8', id: 'f13' },
      { field: 'scene-number', value: '25', id: 'f13' },
    ])
  })

  it('reports the heading it could not recognise, without demoting it', () => {
    expect(imported.headingsNotRecognised).toHaveLength(1)
    const [heading] = imported.headingsNotRecognised
    expect(heading?.text).toBe('INTERCUT - PHONE CALL')
    expect(heading?.reason).toEqual({ kind: 'prefix-not-a-word', looksLike: 'INT' })
    const node = imported.nodes.find((candidate) => candidate.id === heading?.id)
    // Final Draft said heading, so it is one - but it is not a silent one, and
    // derivation still has to fail to resolve `INTERCUT` to a set.
    expect(node?.type).toBe('scene')
  })

  it('reports what it coerced and what it dropped', () => {
    expect(imported.coerced.map((entry) => ({ from: entry.from, to: entry.to }))).toEqual([
      { from: 'Shot', to: 'action' },
      { from: 'General', to: 'action' },
    ])
    expect(imported.unsupported.map((entry) => entry.kind)).toEqual([
      'dual-dialogue',
      'act-structure',
      'cast-list',
      'unknown-type',
      'title-page',
    ])
  })
})

// ---------------------------------------------------------------------------
// Feature length
// ---------------------------------------------------------------------------

describe('a feature-length Final Draft file', () => {
  const SCENES = 220
  const source = featureLengthFdx(SCENES)
  const imported = importOrThrow(source)

  it('actually contains the artefacts it claims to strip', () => {
    expect(source).toMatch(MORE)
    expect(source).toMatch(CONT_D)
    expect(source).toMatch(/SceneProperties[^>]*Page="/u)
  })

  it('imports with zero generated text anywhere in the node stream', () => {
    for (const node of imported.nodes) {
      expect(textOf(node)).not.toMatch(CONT_D)
      expect(textOf(node)).not.toMatch(MORE)
      if (node.type === 'character') {
        for (const modifier of node.modifiers) {
          expect(['V.O.', 'O.S.', 'O.C.']).toContain(modifier)
        }
      }
    }
    expect(imported.stripped.length).toBeGreaterThan(0)
    expect(imported.rejoinedContinuations.length).toBeGreaterThan(0)
  })

  it('accounts for every cue: paragraphs in, minus the page splits, out', () => {
    // The doubling bug as an identity rather than a heuristic. A cue paragraph
    // becomes a Character node unless it was the second half of a page split,
    // in which case it becomes nothing. No third outcome, so no cue can appear
    // twice and none can go missing.
    const cueParagraphs = source
      .split('\n')
      .filter((line) => line.includes('Type="Character"')).length
    const cueNodes = imported.nodes.filter((node) => node.type === 'character').length
    expect(cueParagraphs).toBeGreaterThan(0)
    expect(cueNodes).toBe(cueParagraphs - imported.rejoinedContinuations.length)
  })

  it('never leaves two Dialogue nodes adjacent, which no text format can tell apart', () => {
    let previous: ScreenplayNode['type'] | undefined = undefined
    for (const node of imported.nodes) {
      if (node.type === 'comment') continue
      expect(previous === 'dialogue' && node.type === 'dialogue').toBe(false)
      previous = node.type
    }
  })

  it('carries no page number, on any node, in any form', () => {
    for (const node of imported.nodes) {
      for (const field of PAGINATION_FIELDS) {
        expect(Object.prototype.hasOwnProperty.call(node, field)).toBe(false)
      }
    }
    expect(imported.discarded.length).toBeGreaterThan(SCENES)
  })

  it('has no silent scene', () => {
    expect(imported.headingsNotRecognised.length).toBeGreaterThan(0)
    // Every Scene node either reads as a heading or is named in the report.
    const reported = new Set(imported.headingsNotRecognised.map((entry) => entry.id))
    const scenes = imported.nodes.filter((node) => node.type === 'scene')
    expect(scenes.length).toBe(SCENES + Math.ceil(SCENES / 13))
    for (const scene of scenes) {
      const text = textOf(scene)
      const looksLikeHeading = /^(?:INT\.?\/EXT|I\/E|INT|EXT|EST)\b/iu.test(text)
      expect(looksLikeHeading || reported.has(scene.id)).toBe(true)
    }
  })

  it('a second pass over the node stream strips nothing', () => {
    // FDX *export* is out of scope, so the available second pass is through
    // Fountain, which exists in both directions. Whatever came in as generated
    // text is gone, so there is nothing left for a second import to remove.
    const written = serialiseFountain(imported.nodes)
    expect(written.unrepresentable).toEqual([])
    const reparsed = parseFountain(written.text, {
      freshIds: ids(countFountainNodes(written.text)),
    })
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value.stripped).toEqual([])
    expect(reparsed.value.rejoinedContinuations).toEqual([])
    expect(reparsed.value.nodes.map(summarise)).toEqual(imported.nodes.map(summarise))
  })

  it('importing the same file twice gives the same node list', () => {
    expect(importOrThrow(source).nodes.map(summarise)).toEqual(imported.nodes.map(summarise))
  })

  it('the counts', () => {
    const counts: Record<ScreenplayNodeType, number> = {
      scene: 0,
      action: 0,
      character: 0,
      paren: 0,
      dialogue: 0,
      transition: 0,
      comment: 0,
      subtitle: 0,
    }
    for (const node of imported.nodes) counts[node.type] += 1
    const paragraphs = source.split('\n').filter((line) => line.includes('<Paragraph')).length
    const rows: string[] = [
      '',
      '  feature-length .fdx import - counts',
      '  ------------------------------------------',
      `  fdx paragraphs              ${paragraphs}`,
      `  nodes                       ${imported.nodes.length}`,
      ...SCREENPLAY_NODE_TYPES.map((type) => `    ${type.padEnd(24)}${counts[type]}`),
      `  scenes found                ${counts.scene}`,
      `  headings not recognised     ${imported.headingsNotRecognised.length}`,
      `  continueds stripped         ${
        imported.stripped.filter((entry) => entry.kind === 'cont-d').length
      }`,
      `  (MORE) stripped             ${
        imported.stripped.filter((entry) => entry.kind === 'more').length
      }`,
      `  page splits rejoined        ${imported.rejoinedContinuations.length}`,
      `  paragraphs coerced          ${imported.coerced.length}`,
      `  elements dropped            ${imported.unsupported.length}`,
      `  pagination discarded        ${
        imported.discarded.filter((entry) => entry.field !== 'scene-number').length
      }`,
      `  scene numbers discarded     ${
        imported.discarded.filter((entry) => entry.field === 'scene-number').length
      }`,
      `  doubled continueds          0`,
      `  silent scenes               0`,
      '',
    ]
    console.log(rows.join('\n'))
    expect(imported.nodes.length).toBeGreaterThan(2500)
  })
})
