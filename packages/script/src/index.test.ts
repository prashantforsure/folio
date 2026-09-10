import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME, SCREENPLAY_NODE_TYPES, OUTLINE_NODE_TYPES } from './index'

describe('@folio/script public surface', () => {
  it('exposes its name', () => {
    expect(PACKAGE_NAME).toBe('@folio/script')
  })

  it('exposes both closed block sets and nothing between them', () => {
    expect(SCREENPLAY_NODE_TYPES).toHaveLength(8)
    expect(OUTLINE_NODE_TYPES).toHaveLength(7)
    const overlap = SCREENPLAY_NODE_TYPES.filter((type) =>
      (OUTLINE_NODE_TYPES as readonly string[]).includes(type),
    )
    expect(overlap).toStrictEqual([])
  })
})
