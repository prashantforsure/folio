'use server'

import { listCharacterRecords, listOpenCueRows } from '@folio/db'

import { isRefusal, openProject } from '../script/gate'
import { castRowOf, isCueSubject } from './server'

/**
 * The Characters overlay's list - the 330px peek the rail opens over a
 * writing route (`docs/ui design/Route - Script v2.dc.html`, "CONTEXT
 * OVERLAY"). Read when the overlay opens, not on every navigation: the
 * shell draws the rail on every route and this is a join it does not need
 * until asked.
 *
 * Two kinds of row, as the mockup draws them: a record (`Meera · 34 · 21
 * scenes · lead`) and an unresolved cue (`Landlord · cue only · no record`,
 * flagged). The second is the same open `resolve_rows` the Characters route
 * draws as ghost cards and the rail counts as its badge - one source, three
 * readers.
 */

export type PeekRow = {
  readonly key: string
  readonly name: string
  readonly initials: string
  /** `--chip-N` hue for a record; null for a cue with no record. */
  readonly hue: number | null
  readonly meta: string
  /** A record's id, to open its drawer; null for a cue. */
  readonly characterId: string | null
  readonly unresolved: boolean
}

export type PeekResult =
  | { readonly status: 'ok'; readonly rows: readonly PeekRow[]; readonly total: number }
  | { readonly status: 'refused'; readonly message: string }

const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0)
  const first = words[0] ?? ''
  const second = words[1]
  const pick = second === undefined ? [...first].slice(0, 2).join('') : `${[...first][0] ?? ''}${[...second][0] ?? ''}`
  return pick.toUpperCase()
}

const scenesLabel = (count: number): string => `${String(count)} ${count === 1 ? 'scene' : 'scenes'}`

export const peekCharacters = async (projectId: string): Promise<PeekResult> => {
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const [records, cues] = await Promise.all([listCharacterRecords(gate.scope), listOpenCueRows(gate.scope)])
  const cast = records
    .map(castRowOf)
    .sort((a, b) => b.appearances - a.appearances || b.lines - a.lines || a.name.localeCompare(b.name))
  const rows: PeekRow[] = cast.map((row) => ({
    key: `character:${row.id}`,
    name: row.name,
    initials: initialsOf(row.name),
    hue: row.hue,
    meta: [row.age, scenesLabel(row.appearances), row.role].filter((part): part is string => part !== null && part !== '').join(' · '),
    characterId: row.id,
    unresolved: false,
  }))
  for (const cue of cues) {
    if (!isCueSubject(cue.subject)) continue
    rows.push({
      key: `cue:${cue.key}`,
      name: cue.subject.cue,
      initials: initialsOf(cue.subject.cue),
      hue: null,
      meta: 'cue only · no record',
      characterId: null,
      unresolved: true,
    })
  }
  return { status: 'ok', rows, total: cast.length }
}
