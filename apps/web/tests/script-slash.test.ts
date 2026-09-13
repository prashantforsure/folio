// @vitest-environment node
import { SCREENPLAY_NODE_TYPES } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { DIGIT_TYPES } from '../lib/script/keyboard'
import { SLASH_ENTRIES, filterSlash, slashMenuFor, slashOpensAt, slashQueryClosed } from '../lib/script/slash'

/**
 * The slash menu is the type bar's successor: the same closed set, in the
 * same order, reached by typing. The properties here are that it can never
 * offer more or fewer than the eight, that a query reaches what a writer
 * would expect it to, and that a slash inside a heading is punctuation.
 */

describe('the entries', () => {
  it('are the eight types in the ⌘N order, once each', () => {
    expect(SLASH_ENTRIES.map((entry) => entry.type)).toStrictEqual(DIGIT_TYPES)
    expect(new Set(SLASH_ENTRIES.map((entry) => entry.type))).toStrictEqual(new Set(SCREENPLAY_NODE_TYPES))
    expect(SLASH_ENTRIES.map((entry) => entry.shortcut)).toStrictEqual(['⌘1', '⌘2', '⌘3', '⌘4', '⌘5', '⌘6', '⌘7', '⌘8'])
  })
})

describe('filtering', () => {
  it('reaches a type by its label, then by a keyword, then by anything it contains', () => {
    expect(filterSlash('').map((entry) => entry.type)).toStrictEqual(DIGIT_TYPES)
    expect(filterSlash('sc')[0]?.type).toBe('scene')
    expect(filterSlash('cut')[0]?.type).toBe('transition')
    expect(filterSlash('head')[0]?.type).toBe('scene')
    expect(filterSlash('dia').map((entry) => entry.type)).toStrictEqual(['dialogue'])
    expect(filterSlash('Scene H')[0]?.type).toBe('scene')
    expect(filterSlash('zzz')).toStrictEqual([])
  })
})

describe('the menu', () => {
  it('leads with what the keyboard would do next, then lists every type', () => {
    const fromAction = slashMenuFor('', 'action')
    expect(fromAction.sections.map((section) => section.title)).toStrictEqual(['Suggested', 'Blocks'])
    expect(fromAction.sections[0]?.entries.map((entry) => entry.type)).toStrictEqual(['character'])
    expect(fromAction.sections[1]?.entries.map((entry) => entry.type)).toStrictEqual(DIGIT_TYPES)
    const fromCharacter = slashMenuFor('', 'character')
    expect(fromCharacter.sections[0]?.entries.map((entry) => entry.type)).toStrictEqual(['dialogue'])
    const fromDialogue = slashMenuFor('', 'dialogue')
    expect(fromDialogue.sections[0]?.entries.map((entry) => entry.type)).toStrictEqual(['character', 'paren'])
    expect(fromDialogue.rows).toHaveLength(2 + 8)
  })

  it('folds into one section once the writer types, and is empty when nothing matches', () => {
    const typed = slashMenuFor('tr', 'action')
    expect(typed.sections.map((section) => section.title)).toStrictEqual(['Blocks'])
    expect(typed.rows[0]?.type).toBe('transition')
    expect(slashMenuFor('trans', 'action').rows.map((entry) => entry.type)).toStrictEqual(['transition', 'subtitle'])
    expect(slashMenuFor('zzz', 'action')).toStrictEqual({ sections: [], rows: [] })
  })
})

describe('when a slash is a command', () => {
  it('at the start of a block or after a space, never inside a word', () => {
    expect(slashOpensAt('')).toBe(true)
    expect(slashOpensAt('She waits. ')).toBe(true)
    expect(slashOpensAt('INT.')).toBe(false)
    expect(slashOpensAt('I')).toBe(false)
    expect(slashOpensAt('24')).toBe(false)
  })

  it('closes once a space leads nowhere, and stays open through a space inside a match', () => {
    expect(slashQueryClosed('scene h')).toBe(false)
    expect(slashQueryClosed('and then')).toBe(true)
    expect(slashQueryClosed('scene  ')).toBe(true)
    expect(slashQueryClosed('sc')).toBe(false)
    expect(slashQueryClosed('zzz')).toBe(false)
  })
})
