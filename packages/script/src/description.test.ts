import { describe, expect, it } from 'vitest'

import { dialogueOf, mentionedCharacters, parseDescription, partsText } from './description'
import { characterId } from './ids'

const ADE = characterId('11111111-1111-4111-8111-111111111111')
const OLD = characterId('22222222-2222-4222-8222-222222222222')
const NAMES = [
  { id: ADE, name: 'Ade' },
  { id: OLD, name: 'Old man' },
]

describe('parseDescription', () => {
  it('reads the mockup line into text, mention and dialogue runs', () => {
    const text = '@Ade stops it with the taped boot. Doesn’t look up. “It’s flat.”'
    const parts = parseDescription(text, NAMES)
    expect(parts.map((part) => part.kind)).toEqual(['mention', 'text', 'dialogue'])
    expect(parts[0]).toEqual({ kind: 'mention', text: '@Ade', characterId: ADE })
    expect(parts[2]?.text).toBe('“It’s flat.”')
    expect(partsText(parts)).toBe(text)
  })

  it('takes the longest name on a word boundary, case-insensitively', () => {
    const parts = parseDescription('The @old man on the bench; @Ade at the gate.', NAMES)
    expect(parts.filter((part) => part.kind === 'mention').map((part) => part.characterId)).toEqual([OLD, ADE])
    expect(mentionedCharacters(parts)).toEqual([OLD, ADE])
  })

  it('keeps an unmatched @Name as a mention with no record', () => {
    const parts = parseDescription('@Nia at the fence.', NAMES)
    expect(parts[0]).toEqual({ kind: 'mention', text: '@Nia', characterId: null })
    expect(mentionedCharacters(parts)).toEqual([])
  })

  it('leaves an email-like @ and an unclosed quote as text', () => {
    const parts = parseDescription('mail ade@pitch.org "and nothing', NAMES)
    expect(parts).toEqual([{ kind: 'text', text: 'mail ade@pitch.org "and nothing', characterId: null }])
    expect(dialogueOf(parts)).toBeNull()
  })

  it('round-trips and lists dialogue', () => {
    const text = 'He says "Right." then "Go." to @Ade.'
    const parts = parseDescription(text, NAMES)
    expect(partsText(parts)).toBe(text)
    expect(dialogueOf(parts)).toBe('"Right." "Go."')
  })
})
