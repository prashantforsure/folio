import { describe, expect, it } from 'vitest'

import { avatarUrlFrom, displayNameFrom, initialsFrom } from '../lib/auth/identity'
import { safeNextParam } from '../lib/routes'
import { themeScript } from '../lib/state/theme'

/**
 * The pure parts of auth: identity derivation, the redirect guard, and the
 * no-flash script's contract with the module that reads the same key.
 *
 * Nothing here touches Supabase. The parts that do are exercised end to end,
 * or not at all — see the phase report on what could not be verified without a
 * live project.
 */

describe('display name', () => {
  it('prefers the OAuth claim, which is what Google actually sends', () => {
    expect(displayNameFrom('priya@example.com', { full_name: 'Priya Raman' })).toBe('Priya Raman')
    expect(displayNameFrom('priya@example.com', { name: 'Priya Raman' })).toBe('Priya Raman')
  })

  it('falls back to the local part for a password account, which carries no claims', () => {
    // `users.display_name` is NOT NULL and this phase has no settings page in
    // which to ask. The local part is provisional in a way "User 4821" is not.
    expect(displayNameFrom('priya@example.com', null)).toBe('priya')
    expect(displayNameFrom('priya@example.com', {})).toBe('priya')
  })

  it('ignores a claim that is present but empty, rather than rendering a blank name', () => {
    expect(displayNameFrom('priya@example.com', { full_name: '   ' })).toBe('priya')
  })

  it('ignores a claim that is not a string', () => {
    expect(displayNameFrom('priya@example.com', { full_name: 42 })).toBe('priya')
  })

  it('has a total answer even with neither an email nor a claim', () => {
    expect(displayNameFrom(null, null)).toBe('Signed in')
  })
})

describe('avatar url', () => {
  it('takes avatar_url, then picture, and nothing else', () => {
    expect(avatarUrlFrom({ avatar_url: 'https://a', picture: 'https://b' })).toBe('https://a')
    expect(avatarUrlFrom({ picture: 'https://b' })).toBe('https://b')
    expect(avatarUrlFrom({})).toBeNull()
    expect(avatarUrlFrom(null)).toBeNull()
  })
})

describe('initials', () => {
  it('takes one letter per word, up to two', () => {
    expect(initialsFrom('Priya Raman')).toBe('PR')
    expect(initialsFrom('Priya Anjali Raman')).toBe('PA')
  })

  it('takes one character from a single word, not two', () => {
    // The second character of a lowercased email local part is noise.
    expect(initialsFrom('priya')).toBe('P')
  })

  it('splits on any run of whitespace', () => {
    expect(initialsFrom('  Priya   Raman  ')).toBe('PR')
  })

  it('cuts by code point, so a Devanagari name is not halved', () => {
    // AGENTS.md's own worked example is a Hindi cue. `charAt(0)` on a name
    // outside the BMP returns half a surrogate pair and renders as tofu.
    expect(initialsFrom('मीरा शर्मा')).toBe('मश')
    expect(initialsFrom('𝒫riya')).toBe('𝒫')
  })

  it('has an answer for an empty name rather than rendering nothing', () => {
    expect(initialsFrom('')).toBe('?')
    expect(initialsFrom('   ')).toBe('?')
  })
})

describe('the redirect guard', () => {
  it('keeps an ordinary in-app path', () => {
    expect(safeNextParam('/app/project/abc')).toBe('/app/project/abc')
    expect(safeNextParam('/app?view=map')).toBe('/app?view=map')
  })

  it('rejects an absolute URL', () => {
    expect(safeNextParam('https://evil.example')).toBe('/app')
    expect(safeNextParam('http://evil.example')).toBe('/app')
  })

  it('rejects a protocol-relative URL, which is the case that is easy to miss', () => {
    // A browser reads `//host` as "same scheme, that host". A naive
    // startsWith('/') waves it straight through to another origin.
    expect(safeNextParam('//evil.example')).toBe('/app')
    expect(safeNextParam('//evil.example/app')).toBe('/app')
  })

  it('rejects anything that is not a path at all', () => {
    expect(safeNextParam('app/new')).toBe('/app')
    expect(safeNextParam('javascript:alert(1)')).toBe('/app')
    expect(safeNextParam(undefined)).toBe('/app')
  })

  it('takes the first value when a parameter is repeated', () => {
    // `?next=/app&next=//evil.example` arrives as an array. Taking the last
    // would let an appended parameter win.
    expect(safeNextParam(['/app/recents', '//evil.example'])).toBe('/app/recents')
  })
})

describe('the no-flash theme script', () => {
  it('uses the same storage key as the provider that writes it', () => {
    // The key is written out literally in the script rather than interpolated,
    // because interpolating a value into a script string is the shape of an
    // injection even when today's value is a constant. This is the check that
    // keeps the two copies in step.
    expect(themeScript).toContain("localStorage.getItem('folio.theme')")
  })

  it('accepts only the two theme names', () => {
    expect(themeScript).toContain("t==='light'||t==='dark'")
  })

  it('sets the attribute the cascade reads', () => {
    expect(themeScript).toContain("setAttribute('data-theme',t)")
  })

  it('swallows a storage failure, so private mode renders the default rather than nothing', () => {
    expect(themeScript).toContain('catch(e){}')
  })

  it('interpolates nothing, so it cannot carry a value into a script tag', () => {
    expect(themeScript).not.toContain('${')
  })
})
