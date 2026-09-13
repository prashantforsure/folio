// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  caretBlock,
  demoteAtStart,
  freshBlock,
  insertBlockAfter,
  moveBlock,
  outlineEnter,
  setBlockTypeAt,
} from '../app/(app)/app/project/[projectId]/_outline/editor/extensions/commands'
import { findOutlineSlashMatch } from '../app/(app)/app/project/[projectId]/_outline/editor/extensions/slash'
import { fromDoc } from '../lib/outline/pm-model'
import { block, counterMint, harness } from './helpers/outline-state'

/**
 * The outline's commands, headless. What `⌘N`, Enter, Backspace, `⌥↑↓` and
 * the slash menu do when they say "make this block a beat" - and that the
 * document still reads through the strict reader afterwards, with ADR 0001
 * kept by the identity plugin the harness runs.
 */

describe('setBlockTypeAt', () => {
  it('retypes a textblock in place and the id survives', () => {
    const h = harness([block('a', 'body', 'Logline')], counterMint())
    h.select(0, 3)
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'h1')
    })
    expect(h.types()).toEqual(['h1'])
    expect(h.ids()).toEqual(['a'])
    expect(h.state.doc.child(0).textContent).toBe('Logline')
    expect(h.state.selection.from).toBe(h.at(0, 3))
    expect(fromDoc(h.state.doc).ok).toBe(true)
  })

  it('becoming a rule keeps the id, drops the text, and puts the caret in a body below', () => {
    const h = harness([block('a', 'body', 'gone')], counterMint())
    h.select(0, 2)
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'rule')
    })
    expect(h.types()).toEqual(['rule', 'body'])
    expect(h.ids()).toEqual(['a', 'm1'])
    expect(h.state.selection.from).toBe(h.at(1, 0))
    expect(fromDoc(h.state.doc).ok).toBe(true)
  })

  it('becoming a rule with a block below puts the caret at that block’s start and opens nothing', () => {
    const h = harness([block('a', 'body', ''), block('b', 'body', 'next')], counterMint())
    h.select(0, 0)
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'rule')
    })
    expect(h.types()).toEqual(['rule', 'body'])
    expect(h.ids()).toEqual(['a', 'b'])
    expect(h.state.selection.from).toBe(h.at(1, 0))
  })

  it('leaving a rule opens an empty block of the new type under the same id', () => {
    const h = harness([block('a', 'rule', '')], counterMint())
    h.selectNode(0)
    h.run((tr) => {
      setBlockTypeAt(tr, h.before(0), 'h2')
    })
    expect(h.types()).toEqual(['h2'])
    expect(h.ids()).toEqual(['a'])
    expect(h.state.selection.from).toBe(h.at(0, 0))
    expect(fromDoc(h.state.doc).ok).toBe(true)
  })
})

describe('outlineEnter', () => {
  it('opens body under a heading and another beat under a beat', () => {
    const h = harness([block('a', 'h1', 'Act one'), block('b', 'beat', 'Opening: pitch')], counterMint())
    h.select(0, 7)
    h.run((tr) => {
      outlineEnter(tr)
    })
    expect(h.types()).toEqual(['h1', 'body', 'beat'])
    expect(h.ids()).toEqual(['a', 'm1', 'b'])
    expect(h.state.selection.from).toBe(h.at(1, 0))
    h.select(2, 14)
    h.run((tr) => {
      outlineEnter(tr)
    })
    expect(h.types()).toEqual(['h1', 'body', 'beat', 'beat'])
    expect(h.ids()).toEqual(['a', 'm1', 'b', 'm2'])
  })

  it('ends the list on an empty beat', () => {
    const h = harness([block('a', 'beat', '')], counterMint())
    h.select(0, 0)
    h.run((tr) => {
      outlineEnter(tr)
    })
    expect(h.types()).toEqual(['body'])
    expect(h.ids()).toEqual(['a'])
  })

  it('splits mid-block and the head keeps its id', () => {
    const h = harness([block('a', 'body', 'one two')], counterMint())
    h.select(0, 3)
    h.run((tr) => {
      outlineEnter(tr)
    })
    expect(h.types()).toEqual(['body', 'body'])
    expect(h.ids()).toEqual(['a', 'm1'])
    expect(h.state.doc.child(0).textContent).toBe('one')
    expect(h.state.doc.child(1).textContent).toBe(' two')
    expect(h.state.selection.from).toBe(h.at(1, 0))
  })

  it('at the start of a block with text opens an empty block above and the caret stays with the text', () => {
    const h = harness([block('a', 'h1', 'Act one')], counterMint())
    h.select(0, 0)
    h.run((tr) => {
      outlineEnter(tr)
    })
    expect(h.types()).toEqual(['h1', 'h1'])
    expect(h.ids()).toEqual(['m1', 'a'])
    expect(h.state.selection.from).toBe(h.at(1, 0))
  })

  it('on a selected rule opens body below it', () => {
    const h = harness([block('a', 'rule', '')], counterMint())
    h.selectNode(0)
    h.run((tr) => {
      outlineEnter(tr)
    })
    expect(h.types()).toEqual(['rule', 'body'])
    expect(h.ids()).toEqual(['a', 'm1'])
    expect(h.state.selection.from).toBe(h.at(1, 0))
  })
})

describe('demoteAtStart', () => {
  it('turns a heading into body at its start and declines elsewhere', () => {
    const h = harness([block('a', 'body', 'above'), block('b', 'h2', 'Sequence')], counterMint())
    h.select(1, 3)
    h.run((tr) => {
      expect(demoteAtStart(tr)).toBe(false)
    })
    h.select(1, 0)
    h.run((tr) => {
      expect(demoteAtStart(tr)).toBe(true)
    })
    expect(h.types()).toEqual(['body', 'body'])
    expect(h.ids()).toEqual(['a', 'b'])
  })

  it('declines on body, so Backspace merges into the block above as usual', () => {
    const h = harness([block('a', 'body', 'above'), block('b', 'body', 'below')], counterMint())
    h.select(1, 0)
    h.run((tr) => {
      expect(demoteAtStart(tr)).toBe(false)
    })
  })
})

describe('moveBlock', () => {
  it('swaps with the neighbour, ids travel, the caret stays in the moved block', () => {
    const h = harness([block('a', 'h1', 'One'), block('b', 'body', 'Two'), block('c', 'beat', 'Three')], counterMint())
    h.select(1, 2)
    h.run((tr) => {
      expect(moveBlock(tr, -1)).toBe(true)
    })
    expect(h.ids()).toEqual(['b', 'a', 'c'])
    expect(h.types()).toEqual(['body', 'h1', 'beat'])
    expect(h.state.selection.from).toBe(h.at(0, 2))
    h.run((tr) => {
      expect(moveBlock(tr, -1)).toBe(false)
    })
    h.run((tr) => {
      expect(moveBlock(tr, 1)).toBe(true)
    })
    h.run((tr) => {
      expect(moveBlock(tr, 1)).toBe(true)
    })
    expect(h.ids()).toEqual(['a', 'c', 'b'])
    expect(h.state.selection.from).toBe(h.at(2, 2))
    expect(h.log.minted.size).toBe(0)
    expect(fromDoc(h.state.doc).ok).toBe(true)
  })

  it('moves a selected rule', () => {
    const h = harness([block('a', 'rule', ''), block('b', 'body', 'Two')], counterMint())
    h.selectNode(0)
    h.run((tr) => {
      expect(moveBlock(tr, 1)).toBe(true)
    })
    expect(h.ids()).toEqual(['b', 'a'])
    expect(caretBlock(h.state)?.type).toBe('rule')
  })
})

describe('the slash menu, headless', () => {
  it('matches a slash at a block start or after a space and not inside a word', () => {
    const h = harness([block('a', 'body', '/be'), block('b', 'body', 'and/or'), block('c', 'body', 'so /ru')], counterMint())
    h.select(0, 3)
    expect(findOutlineSlashMatch({ $position: h.state.selection.$from })).toEqual({ range: { from: h.at(0, 0), to: h.at(0, 3) }, query: 'be', text: '/be' })
    h.select(1, 6)
    expect(findOutlineSlashMatch({ $position: h.state.selection.$from })).toBeNull()
    h.select(2, 6)
    expect(findOutlineSlashMatch({ $position: h.state.selection.$from })?.query).toBe('ru')
  })

  it('a pick on a blank block retypes it; on a block with prose it opens one below', () => {
    // The pick itself is `applyOutlineSlashPick`, which needs an editor; its two halves are the commands.
    const h = harness([block('a', 'body', 'prose')], counterMint())
    h.select(0, 5)
    h.run((tr) => {
      const at = caretBlock(tr)
      if (at === null) throw new Error('caret block')
      const below = freshBlock(tr.doc.type.schema, 'beat')
      if (below === null) throw new Error('beat')
      insertBlockAfter(tr, at.pos, below)
    })
    expect(h.types()).toEqual(['body', 'beat'])
    expect(h.ids()).toEqual(['a', 'm1'])
    expect(h.state.selection.from).toBe(h.at(1, 0))
  })
})
