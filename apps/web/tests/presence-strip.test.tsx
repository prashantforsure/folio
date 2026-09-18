import { PRESENCE_STRIP_LIMIT, PresenceStrip } from '@folio/ui'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

/**
 * `@folio/ui`'s `PresenceStrip`: one cell per scene, grouped by episode,
 * three states, nothing for no scenes. Presentational - it is handed the
 * cells and decides nothing about them.
 */

const groups = [
  {
    label: 'E1',
    cells: [
      { key: 'a', state: 'full' as const, title: 'E1 Sc 1 · INT. CHAWL - NIGHT · speaks' },
      { key: 'b', state: 'half' as const, title: 'E1 Sc 2 · INT. OFFICE - DAY · mentioned' },
      { key: 'c', state: 'none' as const, title: 'E1 Sc 3 · EXT. STANDPIPE - DAY · absent' },
    ],
  },
  { label: 'E2', cells: [{ key: 'd', state: 'full' as const, title: 'E2 Sc 1 · INT. CHAWL - DAY · speaks' }] },
]

describe('PresenceStrip', () => {
  it('draws one cell per scene in three states, grouped and labelled by episode', () => {
    const { container } = render(<PresenceStrip groups={groups} size="card" />)
    const strip = container.querySelector('[data-presence-strip="card"]')
    expect(strip).not.toBeNull()
    expect(container.querySelectorAll('[data-presence-group]')).toHaveLength(2)
    const cells = [...container.querySelectorAll('[data-presence-cell]')]
    expect(cells.map((cell) => cell.getAttribute('data-presence-cell'))).toEqual(['full', 'half', 'none', 'full'])
    expect(cells[0]?.getAttribute('title')).toBe('E1 Sc 1 · INT. CHAWL - NIGHT · speaks')
    expect(container.textContent).toContain('E1')
    expect(container.textContent).toContain('E2')
  })

  it('draws no episode labels at the sheet size and nothing at all for no scenes', () => {
    const sheet = render(<PresenceStrip groups={groups} size="sheet" />)
    expect(sheet.container.querySelectorAll('[data-presence-cell]')).toHaveLength(4)
    expect(sheet.container.textContent).not.toContain('E1')
    const empty = render(<PresenceStrip groups={[{ label: 'E1', cells: [] }]} />)
    expect(empty.container.querySelector('[data-presence-strip]')).toBeNull()
  })

  it('publishes the limits the routes fall back to episode bars past', () => {
    expect(PRESENCE_STRIP_LIMIT).toEqual({ card: 96, drawer: 240, sheet: 80 })
  })
})
