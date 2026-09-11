import { describe, expect, it } from 'vitest'

import { relativeTime } from '../lib/format/relative-time'

const NOW = new Date('2026-09-11T12:00:00.000Z')

const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()

describe('relativeTime', () => {
  it('reads the steps the design bundles write out', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('just now')
    expect(relativeTime(ago(60_000), NOW)).toBe('1 minute ago')
    expect(relativeTime(ago(31 * 60_000), NOW)).toBe('31 minutes ago')
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe('2 hours ago')
    expect(relativeTime(ago(26 * 3_600_000), NOW)).toBe('yesterday')
    expect(relativeTime(ago(4 * 86_400_000), NOW)).toBe('4 days ago')
  })

  it('becomes a date past a month, because the day matters more than a count', () => {
    expect(relativeTime('2026-07-01T09:00:00.000Z', NOW)).toBe('1 Jul 2026')
  })

  it('never prints a negative interval when the clocks disagree', () => {
    expect(relativeTime(new Date(NOW.getTime() + 90_000).toISOString(), NOW)).toBe('just now')
  })
})
