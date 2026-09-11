// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { digestOf } from '../lib/script/digest'

describe('digestOf', () => {
  it('is stable for equal values and distinct for close ones', () => {
    const record = { pages: [{ ordinal: 1, label: '1', linesUsed: 54 }], nodes: [{ id: 'a', runs: [{ page: 1 }] }] }
    expect(digestOf(record)).toBe(digestOf(JSON.parse(JSON.stringify(record))))
    expect(digestOf(record)).not.toBe(digestOf({ ...record, pages: [{ ordinal: 1, label: '1', linesUsed: 55 }] }))
    expect(digestOf([record, record])).not.toBe(digestOf([record]))
  })

  it('carries the length, so a transposition cannot pass as the same', () => {
    expect(digestOf('ab')).not.toBe(digestOf('ba'))
    expect(digestOf('ab').endsWith(':4')).toBe(true)
  })
})
