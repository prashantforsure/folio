// @vitest-environment node
import { characterId, labelBook, locationId, mention, text } from '@folio/script'
import type { MentionLabel } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { contentToText, textToContent } from '../lib/storyboard/mentions'

/**
 * The description codec: a mention is a record id in the row and `@Name`
 * in the editor, and the parser never invents a record.
 */

const MEERA = characterId('11111111-1111-4111-8111-111111111111')
const PAWAR = characterId('22222222-2222-4222-8222-222222222222')
const FLAT = locationId('33333333-3333-4333-8333-333333333333')

const labels: readonly MentionLabel[] = [
  { entity: 'character', id: MEERA, label: 'Meera' },
  { entity: 'character', id: PAWAR, label: 'Meera Pawar' },
  { entity: 'location', id: FLAT, label: "Meera's Flat" },
]
const book = labelBook(labels)

describe('contentToText', () => {
  it('prints a mention as @Name from the book and @? when the record is missing', () => {
    expect(
      contentToText(
        [text('Wide on '), mention({ entity: 'character', id: MEERA }), text(' at '), mention({ entity: 'location', id: locationId('missing') })],
        book,
      ),
    ).toBe('Wide on @Meera at @?')
  })
})

describe('textToContent', () => {
  it('turns @Name into a mention, longest label first, case-insensitively', () => {
    expect(textToContent('Two-shot: @meera and @Meera Pawar.', labels)).toEqual([
      text('Two-shot: '),
      mention({ entity: 'character', id: MEERA }),
      text(' and '),
      mention({ entity: 'character', id: PAWAR }),
      text('.'),
    ])
  })

  it('resolves a location with punctuation in its name', () => {
    expect(textToContent("Establishing wide of @Meera's Flat · NIGHT.", labels)).toEqual([
      text('Establishing wide of '),
      mention({ entity: 'location', id: FLAT }),
      text(' · NIGHT.'),
    ])
  })

  it('never invents a record: an unknown @Name stays text', () => {
    expect(textToContent('Close on @Stranger.', labels)).toEqual([text('Close on @Stranger.')])
  })

  it('does not match a label inside a longer word', () => {
    expect(textToContent('@Meeras bag', labels)).toEqual([text('@Meeras bag')])
  })

  it('round-trips content whose mentions are all labelled', () => {
    const content = [text('Two-shot: '), mention({ entity: 'character', id: PAWAR }), text(' and '), mention({ entity: 'character', id: MEERA }), text('.')]
    expect(textToContent(contentToText(content, book), labels)).toEqual(content)
  })

  it('returns an empty list for empty text', () => {
    expect(textToContent('', labels)).toEqual([])
  })
})
