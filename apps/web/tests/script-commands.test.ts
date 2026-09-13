// @vitest-environment node
import type { ScreenplayNode } from '@folio/script'
import { characterId, makeScreenplayNode, nodeId, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  caretBlock,
  freshBlock,
  insertBlockAfter,
  screenplayEnter,
  setBlockTypeAt,
  textBeforeCaret,
} from '../app/(app)/app/project/[projectId]/_script/editor/extensions/commands'
import { findMentionMatch } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/mention-suggestion'
import { findSlashMatch } from '../app/(app)/app/project/[projectId]/_script/editor/extensions/slash'
import { fromDoc, toDoc } from '../lib/script/pm-model'
import { block, counterMint, harness, screenplaySchema } from './helpers/screenplay-state'

/**
 * The commands, headless. What `⌘N`, Tab, Enter, the slash menu and the
 * selectors all do when they say "make this block a Parenthetical" - and
 * that the document still reads through the strict reader afterwards.
 */

describe('setBlockTypeAt', () => {
  it('opens an empty Parenthetical as () with the caret between the parens', () => {
    const h = harness([block('a', 'dialogue', '')], counterMint())
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'paren')
    })
    expect(h.state.doc.child(0).textContent).toBe('()')
    expect(h.state.selection.from).toBe(h.at(0, 1))
    expect(h.ids()).toEqual(['a'])
    expect(fromDoc(h.state.doc).ok).toBe(true)
  })

  it('sheds the wrapping parens when a filled Parenthetical becomes another type', () => {
    const h = harness([block('a', 'paren', '(softly)')], counterMint())
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'action')
    })
    expect(h.state.doc.child(0).type.name).toBe('action')
    expect(h.state.doc.child(0).textContent).toBe('softly')
    expect(h.ids()).toEqual(['a'])
    expect(fromDoc(h.state.doc).ok).toBe(true)
  })

  it('empties out an unfilled () Parenthetical becoming another type', () => {
    const h = harness([block('a', 'paren', '()')], counterMint())
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'dialogue')
    })
    expect(h.state.doc.child(0).type.name).toBe('dialogue')
    expect(h.state.doc.child(0).textContent).toBe('')
  })

  it('keeps modifiers on a Character and drops them leaving one', () => {
    const h = harness([block('a', 'action', 'MEERA')], counterMint())
    h.run((tr) => {
      tr.setNodeMarkup(h.before(0), undefined, { ...tr.doc.child(0).attrs, modifiers: ['V.O.'] })
    })
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'character')
    })
    expect(h.state.doc.child(0).attrs['modifiers']).toEqual(['V.O.'])
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'dialogue')
    })
    expect(h.state.doc.child(0).attrs['modifiers']).toEqual([])
    expect(h.ids()).toEqual(['a'])
  })
})

describe('screenplayEnter', () => {
  it('at the end of a Character opens Dialogue below, unminted then minted', () => {
    const h = harness([block('a', 'character', 'MEERA')], counterMint())
    h.select(0, 5)
    h.run((tr) => {
      screenplayEnter(tr)
    })
    expect(h.state.doc.childCount).toBe(2)
    expect(h.state.doc.child(1).type.name).toBe('dialogue')
    expect(h.ids()).toEqual(['a', 'm1'])
    expect(h.state.selection.from).toBe(h.at(1, 0))
  })

  it('mid-block splits; the head keeps its id', () => {
    const h = harness([block('a', 'action', 'She does not look back.')], counterMint())
    h.select(0, 8)
    h.run((tr) => {
      screenplayEnter(tr)
    })
    expect(h.ids()).toEqual(['a', 'm1'])
    expect(h.state.doc.child(0).textContent).toBe('She does')
    expect(h.state.doc.child(1).textContent).toBe(' not look back.')
    expect(h.state.doc.child(1).type.name).toBe('action')
    expect(h.state.doc.child(1).attrs['provenance']).toEqual(typed())
  })

  it('an empty Character becomes Action; an unfilled () becomes Dialogue', () => {
    const h = harness([block('a', 'character', ''), block('b', 'paren', '()')], counterMint())
    h.select(0, 0)
    h.run((tr) => {
      screenplayEnter(tr)
    })
    expect(h.state.doc.child(0).type.name).toBe('action')
    h.select(1, 1)
    h.run((tr) => {
      screenplayEnter(tr)
    })
    expect(h.state.doc.child(1).type.name).toBe('dialogue')
    expect(h.state.doc.child(1).textContent).toBe('')
    expect(h.ids()).toEqual(['a', 'b'])
  })

  it('Enter at the end of a Comment creates an Action (ruled 2026-09-11)', () => {
    const h = harness([block('a', 'comment', 'note')], counterMint())
    h.select(0, 4)
    h.run((tr) => {
      screenplayEnter(tr)
    })
    expect(h.state.doc.child(1).type.name).toBe('action')
  })
})

describe('insertBlockAfter and freshBlock', () => {
  it('a fresh Parenthetical opens as () with the caret inside', () => {
    const h = harness([block('a', 'character', 'MEERA')], counterMint())
    h.run((tr) => {
      const paren = freshBlock(h.schema, 'paren')
      if (paren === null) throw new Error('schema')
      insertBlockAfter(tr, h.before(0), paren)
    })
    expect(h.state.doc.child(1).textContent).toBe('()')
    expect(h.state.selection.from).toBe(h.at(1, 1))
    expect(h.ids()).toEqual(['a', 'm1'])
  })
})

describe('caretBlock and textBeforeCaret', () => {
  it('names the block under the caret and the text before it', () => {
    const h = harness([block('a', 'scene', 'INT. CHAWL - DAY'), block('b', 'action', 'She waits.')], counterMint())
    h.select(1, 3)
    const at = caretBlock(h.state)
    expect(at?.index).toBe(1)
    expect(at?.type).toBe('action')
    expect(textBeforeCaret(h.state)).toBe('She')
  })
})

describe('findSlashMatch', () => {
  const at = (text: string, offset: number) => {
    const h = harness([block('a', 'action', text)], counterMint())
    h.select(0, offset)
    return findSlashMatch({ $position: h.state.selection.$from })
  }

  it('opens at the start of a block and after a space', () => {
    expect(at('/', 1)?.query).toBe('')
    expect(at('/tr', 3)?.query).toBe('tr')
    expect(at('She waits /sc', 13)?.query).toBe('sc')
    expect(at('/scene h', 8)?.query).toBe('scene h')
  })

  it('is punctuation inside a word', () => {
    expect(at('INT./EXT. CHAWL', 15)).toBeNull()
    expect(at('I/E. CHAWL', 10)).toBeNull()
    expect(at('open 24/7', 9)).toBeNull()
  })

  it('closes once the query has run past the menu', () => {
    expect(at('/zzz ', 5)).toBeNull()
    expect(at('/scene  h', 9)).toBeNull()
  })

  it('reports the range from the slash to the caret', () => {
    const h = harness([block('a', 'action', 'She waits /sc')], counterMint())
    h.select(0, 13)
    const match = findSlashMatch({ $position: h.state.selection.$from })
    expect(match?.range).toEqual({ from: h.at(0, 10), to: h.at(0, 13) })
    expect(match?.text).toBe('/sc')
  })
})

describe('findMentionMatch', () => {
  const at = (text: string, offset: number) => {
    const h = harness([block('a', 'action', text)], counterMint())
    h.select(0, offset)
    return findMentionMatch({ $position: h.state.selection.$from })
  }

  it('opens after @ at the start or after whitespace, with one space allowed in the name', () => {
    expect(at('@Me', 3)?.query).toBe('Me')
    expect(at('with @Young Me', 14)?.query).toBe('Young Me')
  })

  it('is not an address in an email or after two spaces', () => {
    expect(at('meera@chawl.in', 14)).toBeNull()
    expect(at('@Meera  waits', 13)).toBeNull()
  })
})

describe('pm-model round trip', () => {
  it('toDoc then fromDoc is the identity, mentions included', () => {
    const schema = screenplaySchema()
    const nodes: readonly ScreenplayNode[] = [
      block('a', 'scene', 'INT. CHAWL - DAY'),
      makeScreenplayNode('action', {
        id: nodeId('b'),
        provenance: typed(),
        modifiers: [],
        content: [
          { kind: 'text', text: 'Wet washing. ' },
          { kind: 'mention', target: { entity: 'character', id: characterId('c1') } },
          { kind: 'text', text: ' moves through it.\nSideways.' },
        ],
      }),
      makeScreenplayNode('character', {
        id: nodeId('c'),
        provenance: typed(),
        modifiers: ['V.O.'],
        content: [{ kind: 'text', text: 'MEERA' }],
      }),
    ]
    const doc = schema.nodeFromJSON(toDoc(nodes))
    const read = fromDoc(doc)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value).toEqual(nodes)
  })

  it('a block with no id is a defect, never a throw', () => {
    const schema = screenplaySchema()
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'action', attrs: { id: null, provenance: typed(), modifiers: [], origin: null }, content: [] }],
    })
    const read = fromDoc(doc)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error.kind).toBe('model')
  })

  it('a duplicate id is a defect', () => {
    const schema = screenplaySchema()
    const doc = schema.nodeFromJSON(toDoc([block('a', 'action', 'x'), block('a', 'action', 'y')]))
    const read = fromDoc(doc)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error.kind === 'model' && read.error.defect.reason.kind).toBe('duplicate-node-id')
  })
})
