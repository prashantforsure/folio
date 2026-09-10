import type {
  CharacterAuthored,
  CharacterRecord,
  LocationAuthored,
  LocationRecord,
  SceneRecord,
} from '../entities'
import { NO_COUNTS } from '../entities'
import { readCue } from '../generated-text'
import type { CharacterId, LocationId, NodeId } from '../ids'
import { characterId, locationId, nodeId } from '../ids'
import { text } from '../inline'
import type { InlineRun } from '../inline'
import type { ScreenplayNode, ScreenplayNodeType } from '../node'
import { makeScreenplayNode } from '../node'
import { typed } from '../provenance'

/**
 * Test support for derivation.
 *
 * A script here is a list of `type:text` lines, so a test reads as the script it
 * is about rather than as forty lines of node construction. Ids are `n1`, `n2`
 * ... in order, which is what makes a scene's id predictable in an assertion -
 * a scene record is keyed by its heading node.
 *
 * Cues go through `readCue` on the way in, so a corpus line reading
 * `cue:MEERA (V.O.)` produces the node the parser would have produced: content
 * `MEERA`, modifiers `['V.O.']`. A test that wants the other shape - a modifier
 * still sitting in the text - writes it with `rawCue:`.
 */

const TYPE_BY_PREFIX: Readonly<Record<string, ScreenplayNodeType>> = {
  scene: 'scene',
  action: 'action',
  cue: 'character',
  rawCue: 'character',
  paren: 'paren',
  dialogue: 'dialogue',
  transition: 'transition',
  comment: 'comment',
  subtitle: 'subtitle',
}

export type ScriptLine = string | { readonly type: ScreenplayNodeType; readonly runs: readonly InlineRun[] }

export const nodesOf = (lines: readonly ScriptLine[]): readonly ScreenplayNode[] =>
  lines.map((line, index) => {
    const id = nodeId(`n${String(index + 1)}`)
    if (typeof line !== 'string') {
      return makeScreenplayNode(line.type, {
        id,
        provenance: typed(),
        content: line.runs,
        modifiers: [],
      })
    }
    const colon = line.indexOf(':')
    const prefix = colon === -1 ? '' : line.slice(0, colon)
    const body = colon === -1 ? line : line.slice(colon + 1)
    const type = TYPE_BY_PREFIX[prefix] ?? 'action'
    if (prefix === 'cue') {
      const reading = readCue(body)
      return makeScreenplayNode('character', {
        id,
        provenance: typed(),
        content: [text(reading.name)],
        modifiers: reading.modifiers,
      })
    }
    return makeScreenplayNode(type, {
      id,
      provenance: typed(),
      content: [text(body)],
      modifiers: [],
    })
  })

/** Node ids in the order `nodesOf` assigns them. */
export const idAt = (index: number): NodeId => nodeId(`n${String(index + 1)}`)

export const characterAuthored = (
  parts: Partial<CharacterAuthored> & { readonly name: string },
): CharacterAuthored => ({
  name: parts.name,
  boundCues: parts.boundCues ?? [parts.name],
  bio: parts.bio ?? null,
  relationships: parts.relationships ?? [],
  notes: parts.notes ?? {},
})

/** A record as it would come back from a previous pass. Counts are re-derived. */
export const characterRecord = (
  id: string,
  authored: CharacterAuthored,
): CharacterRecord => ({
  id: characterId(id),
  authored,
  cues: [],
  appearances: 0,
  scenes: [],
  lines: 0,
  mentions: 0,
  presence: 'absent',
})

export const locationAuthored = (
  parts: Partial<LocationAuthored> & { readonly name: string },
): LocationAuthored => ({
  name: parts.name,
  parent: parts.parent ?? null,
  boundSluglines: parts.boundSluglines ?? [parts.name],
  scheduledDays: parts.scheduledDays ?? 0,
  description: parts.description ?? null,
  notes: parts.notes ?? {},
})

export const locationRecord = (id: string, authored: LocationAuthored): LocationRecord => ({
  id: locationId(id),
  authored,
  sluglines: [],
  children: [],
  depth: 0,
  own: NO_COUNTS,
  rollup: NO_COUNTS,
  scenes: [],
  presence: 'absent',
})

export const sceneAuthoredRecord = (
  scene: SceneRecord,
  authored: SceneRecord['authored'],
): SceneRecord => ({ ...scene, authored })

export const character = (id: string): CharacterId => characterId(id)
export const location = (id: string): LocationId => locationId(id)
