import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME } from './index'

describe('@folio/script scaffold', () => {
  it('exposes its placeholder export', () => {
    expect(PACKAGE_NAME).toBe('@folio/script')
  })

  it('runs fast-check property tests in this package', () => {
    // A deliberately trivial property. Its only job is to prove the fast-check
    // harness executes here. Phase 2 replaces it with the properties that
    // actually matter: node identity under paste, split, merge and reorder
    // (AGENTS.md, Feature workflow step 5).
    fc.assert(
      fc.property(fc.array(fc.string()), (xs) => {
        const roundTripped = [...xs].reverse().reverse()
        return roundTripped.length === xs.length && roundTripped.every((x, i) => x === xs[i])
      }),
    )
  })
})
