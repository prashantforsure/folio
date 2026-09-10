import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { REVISION_COLOURS } from '@folio/script'
import { REVISION_COLOUR_NAMES, isRevisionColourName, revisionColourVar } from '@folio/ui'
import { describe, expect, it } from 'vitest'

/**
 * The two guarantees AGENTS.md makes about revision colours.
 *
 * > Revision colours (White → Blue → Pink → Yellow → Green) are industry
 * > artefacts, not palette tokens, and must survive a theme switch intact.
 *
 * **One list.** `@folio/script` is the authority. `@folio/ui` transcribes it,
 * because AGENTS.md, Architecture makes that package presentational and this
 * phase's brief forbids it importing `@folio/script` at all. This file may
 * import both, so it is where the copy is held to the original — in value and
 * in order, because the order *is* the revision sequence.
 *
 * **Not a theme token.** Asserted against the stylesheet, by reading it.
 * `revision.css` must declare `--rev-*` exactly once, under `:root`, and must
 * contain no `[data-theme…]` block at all: a theme block cannot override a
 * variable it does not mention, so the absence is the guarantee. Checking the
 * source rather than a rendered colour catches the regression at the moment
 * somebody adds the block — rather than the first time a producer notices that
 * a pink page went salmon.
 */

/*
 * Resolved from the Vitest root (`apps/web`) rather than from `import.meta.url`:
 * Vite rewrites module URLs during transform, so `import.meta.url` is not
 * reliably a `file:` URL inside a test and `fileURLToPath` throws on it.
 */
const REVISION_CSS = resolve(process.cwd(), '../../packages/ui/src/tokens/revision.css')

const revisionCss = readFileSync(REVISION_CSS, 'utf8')

// The header comment explains the rule and therefore mentions `data-theme`.
// Only the CSS is under test.
const rules = revisionCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the revision colour list', () => {
  it('matches @folio/script exactly, in sequence order', () => {
    expect([...REVISION_COLOUR_NAMES]).toEqual([...REVISION_COLOURS])
  })

  it('is White → Blue → Pink → Yellow → Green, as AGENTS.md writes it', () => {
    expect([...REVISION_COLOUR_NAMES]).toEqual(['white', 'blue', 'pink', 'yellow', 'green'])
  })

  it('recognises its own members and nothing else', () => {
    expect(REVISION_COLOUR_NAMES.every(isRevisionColourName)).toBe(true)
    expect(isRevisionColourName('salmon')).toBe(false)
    expect(isRevisionColourName('goldenrod')).toBe(false)
  })

  it('composes the custom property name in exactly one place', () => {
    expect(revisionColourVar('pink')).toBe('var(--rev-pink)')
  })
})

describe('revision colours are not theme tokens', () => {
  it('declares every colour, once', () => {
    for (const name of REVISION_COLOUR_NAMES) {
      const declarations = rules.match(new RegExp(`--rev-${name}\\s*:`, 'g')) ?? []
      expect({ name, declarations: declarations.length }).toEqual({ name, declarations: 1 })
    }
  })

  it('contains no theme block, so no theme can override a value', () => {
    expect(rules).not.toContain('data-theme')
  })

  it('uses :root and no other selector', () => {
    const selectors = [...rules.matchAll(/([^{}]+)\{/g)].map((match) => match[1]?.trim() ?? '')
    expect(selectors).toEqual([':root'])
  })
})
