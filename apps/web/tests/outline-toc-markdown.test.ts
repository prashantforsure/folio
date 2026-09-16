// @vitest-environment node
import type { OutlineNode } from '@folio/script'
import { characterId, labelBook, nodeId, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { outlineFilename, outlineMarkdown } from '../lib/outline/markdown'
import type { TocRow } from '../lib/outline/toc'
import { TITLE_ROW_ID, activeTocRow, tocLevelLabel } from '../lib/outline/toc'

/**
 * The two pure reads the Outline's v2 pass added: the sidebar's lit row
 * and the Markdown export. Both are arithmetic over the block list, and
 * both are what the mockup's derived fields depend on.
 */

const text = (value: string) => [{ kind: 'text' as const, text: value }]

const block = (type: OutlineNode['type'], id: string, value = ''): OutlineNode =>
  type === 'rule'
    ? { type, id: nodeId(id), provenance: typed() }
    : ({ type, id: nodeId(id), provenance: typed(), content: text(value) } as OutlineNode)

describe('the sidebar list', () => {
  const rows: readonly TocRow[] = [
    { id: TITLE_ROW_ID, text: 'Not Magic, Just This', level: 'title' },
    { id: 'h-log', text: 'Logline', level: 1 },
    { id: 'h-syn', text: 'Synopsis', level: 1 },
    { id: 'h-beats', text: 'Story Beats', level: 1 },
  ]
  const ids = ['h-log', 'p-1', 'h-syn', 'p-2', 'q-1', 'p-3', 'r-1', 'h-beats', 'b-1', 'b-2']

  it('lights the heading the caret is under, the title before the first heading', () => {
    expect(activeTocRow(rows, ids, 'p-2')).toBe('h-syn')
    expect(activeTocRow(rows, ids, 'q-1')).toBe('h-syn')
    expect(activeTocRow(rows, ids, 'b-2')).toBe('h-beats')
    expect(activeTocRow(rows, ids, 'h-log')).toBe('h-log')
    expect(activeTocRow(rows, ids, null)).toBe(TITLE_ROW_ID)
    expect(activeTocRow(rows, ['p-0', ...ids], 'p-0')).toBe(TITLE_ROW_ID)
  })

  it('falls back to the title for a caret the list does not know, and to nothing for no rows', () => {
    expect(activeTocRow(rows, ids, 'gone')).toBe(TITLE_ROW_ID)
    expect(activeTocRow([], ids, 'p-2')).toBeNull()
  })

  it('prints the level chip as the mockup does', () => {
    expect(tocLevelLabel('title')).toBe('title')
    expect(tocLevelLabel(1)).toBe('H1')
    expect(tocLevelLabel(3)).toBe('H3')
  })
})

describe('the Markdown export', () => {
  it('writes one construct per block, numbers the beats and bolds their leads', () => {
    const nodes: readonly OutlineNode[] = [
      block('h1', 'a', 'Logline'),
      block('body', 'b', 'One sentence, one kick.'),
      block('quote', 'c', 'Not gifted. Just stubborn.'),
      block('rule', 'd'),
      block('h1', 'e', 'Story Beats'),
      block('beat', 'f', 'Opening Image: empty pitch.'),
      block('beat', 'g', 'The Kick: crossbar, far corner.'),
      block('h2', 'h', 'Act two'),
      block('h3', 'i', 'The pitch at night'),
    ]
    expect(outlineMarkdown('Not Magic, Just This', nodes, labelBook([]))).toBe(
      [
        '# Not Magic, Just This',
        '',
        '## Logline',
        '',
        'One sentence, one kick.',
        '',
        '> Not gifted. Just stubborn.',
        '',
        '---',
        '',
        '## Story Beats',
        '',
        '1. **Opening Image:** empty pitch.',
        '2. **The Kick:** crossbar, far corner.',
        '',
        '### Act two',
        '',
        '#### The pitch at night',
        '',
      ].join('\n'),
    )
  })

  it('renders a mention by its label', () => {
    const nodes: readonly OutlineNode[] = [
      {
        type: 'body',
        id: nodeId('m'),
        provenance: typed(),
        content: [{ kind: 'mention', target: { entity: 'character', id: characterId('c1') } }, { kind: 'text', text: ' walks home.' }],
      },
    ]
    const book = labelBook([{ entity: 'character', id: characterId('c1'), label: 'Ade' }])
    expect(outlineMarkdown('T', nodes, book)).toContain('Ade walks home.')
  })

  it('names the file after the title, as a slug, never empty', () => {
    expect(outlineFilename('Not Magic, Just This')).toBe('not-magic-just-this-outline.md')
    expect(outlineFilename('Épisode 1 · Standpipe')).toBe('episode-1-standpipe-outline.md')
    expect(outlineFilename('   ')).toBe('outline-outline.md')
  })
})
