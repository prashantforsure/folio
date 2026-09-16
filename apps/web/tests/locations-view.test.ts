// @vitest-environment node
import type { LocationRow, SceneRef } from '@folio/contracts'
import { episodeSlug } from '@folio/contracts'
import type { LocationId } from '@folio/script'
import { locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { NO_LOCATION_COUNTS } from '../lib/locations/figures'
import {
  dayNightLabel,
  grouped,
  hueOf,
  ieKindLine,
  kindLabel,
  kindOf,
  matchesFind,
  metaLine,
  metaLong,
  passesFilter,
  scoutedOf,
  sluglineNote,
  statusLeft,
  statusTone,
  unmatchedLabel,
} from '../lib/locations/view'

/**
 * The derived fields the v2 Locations route prints - `Route - Locations
 * v2.dc.html`'s `data()` computed rather than authored. Each test names
 * the line of the mockup it produces.
 *
 * Node environment: nothing here renders (`apps/web/CLAUDE.md`, trap 1).
 */

const place = (n: number): LocationId => locationId(`20000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const ref = (episodeOrdinal: number, number: number): SceneRef => ({
  sceneNodeId: nodeId(`00000000-0000-4000-8000-${String(episodeOrdinal * 100 + number).padStart(12, '0')}`),
  episode: episodeSlug(`ep_${String(episodeOrdinal).padStart(3, '0')}`),
  episodeOrdinal,
  number,
  heading: 'INT. SOMEWHERE - DAY',
})

const row = (
  name: string,
  n: number,
  parts: Partial<Omit<LocationRow, 'scenes'>> & { readonly scenes?: number; readonly day?: number; readonly night?: number } = {},
): LocationRow => {
  const { scenes = 0, day = 0, night = 0, ...rest } = parts
  const counts = { ...NO_LOCATION_COUNTS, scenes, dayScenes: day, nightScenes: night }
  const base: LocationRow = {
    id: place(n),
    name,
    parentId: null,
    parent: null,
    depth: 0,
    ie: 'INT',
    presence: scenes > 0 ? 'present' : 'absent',
    kind: 'recurring',
    own: counts,
    rollup: counts,
    children: 0,
    status: 'pending',
    address: null,
    description: null,
    photoUrl: null,
    sluglines: [],
    boundSluglines: [],
    scenes: [],
    people: [],
    perEpisode: [],
    eighths: null,
    firstSeen: null,
    lastSeen: null,
    nameHeadings: 0,
    conflicts: [],
    ...rest,
  }
  return { ...base, kind: rest.kind ?? kindOf(base) }
}

describe('kindOf and kindLabel', () => {
  it('reads the mockup’s kind off the tree and the count', () => {
    const chawl = row('Kamathi Chawl', 1, { scenes: 9, children: 5, ie: 'INT/EXT' })
    expect(chawl.kind).toBe('primary')
    expect(kindLabel(chawl)).toBe('Primary set')
    expect(ieKindLine(chawl)).toBe('INT/EXT · Primary set')

    const corridor = row('Corridor', 2, { scenes: 6, parentId: place(1), parent: { id: place(1), name: 'Kamathi Chawl' } })
    expect(corridor.kind).toBe('sub')
    expect(kindLabel(corridor)).toBe('Inside Kamathi Chawl')

    expect(kindLabel(row('Tanker stand', 3, { scenes: 6, ie: 'EXT' }))).toBe('Recurring exterior')
    expect(kindLabel(row('Kadam’s office', 4, { scenes: 4, ie: 'INT' }))).toBe('Recurring interior')
    expect(kindLabel(row('Both', 5, { scenes: 3, ie: 'INT/EXT' }))).toBe('Recurring set')
    expect(kindLabel(row('Tank room', 6, { scenes: 1 }))).toBe('One-off')
  })

  it('prints the README’s line for a record with no scene', () => {
    const gone = row('Gone', 7, { ie: null })
    expect(gone.kind).toBe('off-page')
    expect(kindLabel(gone)).toBe('Not on the page yet')
    expect(ieKindLine(gone)).toBe('— · Not on the page yet')
  })
})

describe('the meta lines', () => {
  it('prints the card’s `9 scenes · 41 2/8 pp` and the drawer’s long form', () => {
    const chawl = row('Kamathi Chawl', 1, { scenes: 9, eighths: 330, firstSeen: ref(1, 1) })
    expect(metaLine(chawl)).toBe('9 scenes · 41 2/8 pp')
    expect(metaLong(chawl)).toBe('9 scenes · 41 2/8 pages · first in E1 Sc 1')
    expect(metaLong(row('One', 2, { scenes: 1, eighths: 8, firstSeen: ref(3, 4) }))).toBe('1 scene · 1 page · first in E3 Sc 4')
    expect(metaLong(row('Unmeasured', 3, { scenes: 2, firstSeen: ref(2, 9) }))).toBe('2 scenes · first in E2 Sc 9')
  })

  it('says `Not on the page yet` for a record with no scene, everywhere a count would go', () => {
    const gone = row('Gone', 4)
    expect(metaLine(gone)).toBe('Not on the page yet')
    expect(metaLong(gone)).toBe('Not on the page yet')
    expect(sluglineNote([])).toBe('Not on the page yet')
    expect(sluglineNote([{ occurrences: 6 }, { occurrences: 5 }])).toBe('11 in the script')
  })

  it('prints the sheet’s day / night column', () => {
    expect(dayNightLabel({ dayScenes: 4, nightScenes: 5 })).toBe('4 d · 5 n')
  })
})

describe('status', () => {
  it('follows the README’s strict colour: amber pending, green scouted, accent locked', () => {
    expect(statusTone('pending')).toBe('warn')
    expect(statusTone('scouted')).toBe('ok')
    expect(statusTone('locked')).toBe('accent')
  })

  it('counts the sidebar widget the way the mockup does - locked counts as scouted', () => {
    const rows = [{ status: 'scouted' as const }, { status: 'locked' as const }, { status: 'pending' as const }, { status: 'pending' as const }]
    expect(scoutedOf(rows)).toEqual({ scouted: 2, total: 4, percent: 50, note: '2 still pending' })
    expect(scoutedOf([{ status: 'scouted' }])).toEqual({ scouted: 1, total: 1, percent: 100, note: 'Nothing still pending' })
    expect(scoutedOf([])).toEqual({ scouted: 0, total: 0, percent: 0, note: 'No locations yet' })
  })

  it('filters by status, or not at all', () => {
    expect(passesFilter({ status: 'locked' }, 'all')).toBe(true)
    expect(passesFilter({ status: 'locked' }, 'locked')).toBe(true)
    expect(passesFilter({ status: 'locked' }, 'pending')).toBe(false)
  })
})

describe('grouped', () => {
  it('lists the mockup’s three groups, a sub-set under its parent’s, and the off-page records last', () => {
    const chawl = row('Kamathi Chawl', 1, { scenes: 9, children: 1 })
    const corridor = row('Corridor', 2, { scenes: 6, parentId: chawl.id, parent: { id: chawl.id, name: chawl.name } })
    const tanker = row('Tanker stand', 3, { scenes: 6 })
    const tank = row('Tank room', 4, { scenes: 1 })
    const gone = row('Gone', 5)
    const groups = grouped([chawl, corridor, tanker, tank, gone])
    expect(groups.map((group) => [group.group, group.rows.map((entry) => entry.name)])).toEqual([
      ['primary', ['Kamathi Chawl', 'Corridor']],
      ['recurring', ['Tanker stand']],
      ['one-off', ['Tank room']],
      ['off-page', ['Gone']],
    ])
  })

  it('leaves out a group with nothing in it', () => {
    expect(grouped([row('Tanker stand', 3, { scenes: 6 })]).map((group) => group.group)).toEqual(['recurring'])
  })
})

describe('the find field', () => {
  it('matches a name, a counted heading or a bound set text, case-folded; an empty query matches all', () => {
    const chawl = row('Kamathi Chawl', 1, {
      sluglines: [{ slugline: 'INT. CHAWL CORRIDOR - DAY', occurrences: 6 }],
      boundSluglines: ['KAMATHI CHAWL', 'THE CHAWL'],
    })
    expect(matchesFind(chawl, '')).toBe(true)
    expect(matchesFind(chawl, 'kamathi')).toBe(true)
    expect(matchesFind(chawl, 'corridor')).toBe(true)
    expect(matchesFind(chawl, 'the chawl')).toBe(true)
    expect(matchesFind(chawl, 'tanker')).toBe(false)
  })
})

describe('the banner and the status bar', () => {
  it('prints the banner’s line, singular and plural', () => {
    expect(unmatchedLabel(1)).toBe("1 slugline doesn't point at a location")
    expect(unmatchedLabel(3)).toBe("3 sluglines don't point at a location")
  })

  it('prints `6 locations · 29 scenes · Kamathi Chawl`, and drops the name with nothing selected', () => {
    const rows = [row('Kamathi Chawl', 1, { scenes: 9 }), row('Tanker stand', 2, { scenes: 6 })]
    expect(statusLeft(rows, 29, rows[0] ?? null)).toBe('2 locations · 29 scenes · Kamathi Chawl')
    expect(statusLeft(rows, 29, null)).toBe('2 locations · 29 scenes')
    expect(statusLeft([rows[0] as LocationRow], 1, null)).toBe('1 location · 1 scene')
  })
})

describe('hueOf', () => {
  it('is a stable hue in 0..359 for the same id', () => {
    const hue = hueOf(place(1))
    expect(hue).toBe(hueOf(place(1)))
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
    expect(hueOf(place(2))).not.toBe(hue)
  })
})
