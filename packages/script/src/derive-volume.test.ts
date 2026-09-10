import { describe, expect, it } from 'vitest'

import type { Derivation } from './derive'
import { countDerivationIds, derive } from './derive'
import type { DerivedEntities, LocationRecord } from './entities'
import { NO_ENTITIES } from './entities'
import { countFdxNodes, importFinalDraft } from './fdx'
import { locationId, nodeId } from './ids'
import type { ScreenplayNode } from './node'
import { featureLengthFdx } from './testing/fdx-corpus'
import { readFdxXml } from './testing/fdx-reader'

/**
 * Derivation at volume, over the feature-length Final Draft file from the import
 * work.
 *
 * The counts are asserted rather than snapshotted, because a snapshot of 220
 * scenes tells a reviewer nothing and gets re-recorded the moment it fails. The
 * numbers here are the ones the brief asks to see: characters, alias variants
 * per character, locations by tree depth, scenes, and resolve-queue rows by
 * confidence. The report is printed so the run itself shows them.
 *
 * The corpus is synthetic - assembled deterministically to feature length, not a
 * real screenplay. It is a real *volume* and a real set of shapes (repaginated
 * splits, speaker continueds, headings Final Draft declared and Fountain would
 * not), which is what these counts are worth.
 */

const ids = (count: number, prefix: string): readonly string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)

const feature = (): readonly ScreenplayNode[] => {
  const tree = readFdxXml(featureLengthFdx())
  const imported = importFinalDraft(tree, {
    freshIds: Array.from({ length: countFdxNodes(tree) }, (_, index) =>
      nodeId(`fdx${String(index)}`),
    ),
  })
  if (!imported.ok) throw new Error(`import failed: ${JSON.stringify(imported.error)}`)
  return imported.value.nodes
}

const derived = (
  nodes: readonly ScreenplayNode[],
  previous: DerivedEntities,
  prefix: string,
): Derivation => {
  const result = derive(nodes, previous, {
    freshIds: ids(countDerivationIds(nodes, previous), prefix),
  })
  if (!result.ok) throw new Error(`derive failed: ${JSON.stringify(result.error)}`)
  return result.value
}

/**
 * What the caller does when the writer accepts a `new-parent` proposal.
 *
 * Not derivation's job - it is here to show the tree working once a human has
 * drawn it, and to prove the roll-up. `packages/db` will do this for real;
 * writing it in the test is the honest way to demonstrate the edge without
 * derivation ever writing one.
 */
const acceptNewParents = (entities: DerivedEntities): DerivedEntities => {
  const parents = new Map<string, LocationRecord>()
  const children = new Map<string, string>()

  for (const row of entities.queue) {
    if (row.subject.kind !== 'structure') continue
    if (row.proposal?.target.kind !== 'new-parent') continue
    const name = row.proposal.target.name
    const id = `set-${name.replace(/\s+/gu, '-').toLowerCase()}`
    if (!parents.has(id)) {
      parents.set(id, {
        id: locationId(id),
        authored: {
          name,
          parent: null,
          boundSluglines: [],
          scheduledDays: 2,
          description: null,
          notes: {},
        },
        sluglines: [],
        children: [],
        depth: 0,
        own: { scenes: 0, sluglines: 0, dayScenes: 0, nightScenes: 0, shootingDays: 0 },
        rollup: { scenes: 0, sluglines: 0, dayScenes: 0, nightScenes: 0, shootingDays: 0 },
        scenes: [],
        presence: 'absent',
      })
    }
    children.set(String(row.subject.location), id)
  }

  return {
    ...entities,
    locations: [
      ...entities.locations.map((record) => {
        const parent = children.get(String(record.id))
        return parent === undefined
          ? record
          : {
              ...record,
              authored: { ...record.authored, parent: locationId(parent), scheduledDays: 1 },
            }
      }),
      ...parents.values(),
    ],
  }
}

const report = (title: string, derivation: Derivation): string => {
  const { entities } = derivation
  const characters = [...entities.characters].sort((a, b) => b.lines - a.lines)
  const byDepth = new Map<number, number>()
  for (const record of entities.locations) {
    byDepth.set(record.depth, (byDepth.get(record.depth) ?? 0) + 1)
  }
  const open = entities.queue.filter((row) => row.state === 'open')
  const byConfidence = new Map<string, number>()
  for (const row of open) {
    const label = row.proposal === null ? 'no proposal (walk-on)' : row.proposal.confidence
    byConfidence.set(label, (byConfidence.get(label) ?? 0) + 1)
  }
  const roots = entities.locations.filter((record) => record.depth === 0)

  const lines = [
    `── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`,
    `scenes                 ${String(entities.scenes.length)}`,
    `headings rejected      ${String(derivation.rejectedHeadings.length)} (reported, not scenes)`,
    `characters             ${String(entities.characters.length)}`,
    `locations              ${String(entities.locations.length)}`,
    `ids minted this pass   ${String(derivation.minted.length)}`,
    '',
    'characters · alias variants · scenes · lines',
    ...characters.map(
      (record) =>
        `  ${record.authored.name.padEnd(22)} ${String(record.cues.length).padStart(2)} variant(s)  ` +
        `${String(record.appearances).padStart(3)} scenes  ${String(record.lines).padStart(4)} lines  ` +
        `[${record.cues.map((cue) => `${cue.cue} ${String(cue.occurrences)}`).join(' · ')}]`,
    ),
    '',
    'locations by tree depth',
    ...[...byDepth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, count]) => `  depth ${String(depth)}   ${String(count)}`),
    '',
    'primary sets · own scenes · rolled-up scenes · rolled-up shooting days',
    ...roots.map(
      (record) =>
        `  ${record.authored.name.padEnd(34)} own ${String(record.own.scenes).padStart(3)}  ` +
        `rollup ${String(record.rollup.scenes).padStart(3)}  days ${String(record.rollup.shootingDays).padStart(3)}`,
    ),
    '',
    `resolve queue · ${String(open.length)} open of ${String(entities.queue.length)} rows`,
    ...[...byConfidence.entries()].map(
      ([label, count]) => `  ${label.padEnd(22)} ${String(count)}`,
    ),
  ]
  return lines.join('\n')
}

describe('derivation over the feature-length Final Draft file', () => {
  const nodes = feature()

  it('derives the whole file, and re-derives it byte-identically', () => {
    const first = derived(nodes, NO_ENTITIES, 'a')
    const second = derived(nodes, first.entities, 'b')

    expect(countDerivationIds(nodes, first.entities)).toBe(0)
    expect(second.minted).toStrictEqual([])
    expect(JSON.stringify(second.entities)).toBe(JSON.stringify(first.entities))

    const tree = acceptNewParents(first.entities)
    const third = derived(nodes, tree, 'c')

    console.log(`\n${report('cold pass · nothing authored yet', first)}\n`)
    console.log(`${report('after the writer accepts the parent proposals', third)}\n`)

    expect(nodes.length).toBeGreaterThan(2500)
    expect(first.entities.scenes.length).toBe(220)
    expect(first.rejectedHeadings.length).toBe(17)
    expect(first.entities.characters).toHaveLength(6)
    expect(first.entities.locations).toHaveLength(10)

    // Every heading Final Draft declared but Fountain rejects stayed out of the
    // scene list and was reported instead.
    expect(first.entities.scenes.length + first.rejectedHeadings.length).toBe(237)
  })

  it('puts every modifier variation of a name on one record', () => {
    const first = derived(nodes, NO_ENTITIES, 'a')
    const meera = first.entities.characters.find((record) => record.authored.name === 'MEERA')
    // First-appearance order, which in this corpus puts the (V.O.) first.
    expect([...(meera?.cues ?? [])].map((cue) => cue.cue).sort()).toStrictEqual([
      'MEERA',
      'MEERA (V.O.)',
    ])
    expect(meera?.cues.every((cue) => cue.key === 'MEERA')).toBe(true)
  })

  it('rolls scenes and shooting days up a tree the writer drew', () => {
    const first = derived(nodes, NO_ENTITIES, 'a')
    const third = derived(nodes, acceptNewParents(first.entities), 'c')

    const chawl = third.entities.locations.find(
      (record) => record.authored.name === 'THE CHAWL' && record.depth === 0,
    )
    if (chawl === undefined) throw new Error('the chawl was not created')

    expect(chawl.presence).toBe('absent')
    expect(chawl.own.scenes).toBe(0)
    expect(chawl.children).toHaveLength(2)
    expect(chawl.rollup.scenes).toBe(
      chawl.children
        .map((child) => third.entities.locations.find((record) => record.id === child))
        .reduce((total, record) => total + (record?.own.scenes ?? 0), 0),
    )
    expect(chawl.rollup.shootingDays).toBe(2 + 1 + 1)
    expect(third.entities.locations.filter((record) => record.depth === 1)).toHaveLength(4)
  })
})
