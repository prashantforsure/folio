'use client'

import type { CharacterMap, ExchangeRow, ProjectId, SceneFacts } from '@folio/contracts'
import { IdentityChip } from '@folio/ui'
import type { CharacterId, NodeId } from '@folio/script'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { CastFigure, CastGroup } from '../../../../../../lib/characters/cast'
import { mapOf, neverShare, sharedPairs, sharedRefs, silentPair } from '../../../../../../lib/characters/cast'
import { citeOf, formatSceneRef } from '../../../../../../lib/characters/figures'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'

/**
 * The Presence view (ruled 2026-09-17, replacing the Relationships graph):
 * a character × scene grid, by episode, one 12px cell per scene - filled
 * when the character speaks, hollow when only mentioned, faint when
 * absent - with the names down a sticky column and the episode eyebrows
 * along a sticky row; a hover line under it saying which scene and who;
 * then `Pairs` - every two characters who share a scene, most shared
 * first, with a bar scaled to the strongest pair and the scenes as linked
 * chips - and the finding cards: two principals who never share a scene,
 * and two who share many but rarely speak to each other.
 *
 * Every cell is the scene index (`SceneFacts.speaking` / `mentioned`); every
 * pair count is the map (`buildMap`); the exchanges are the pass's. Rows
 * are the sidebar's order with off-page records left out, narrowed by the
 * toolbar's filter like every view. Nothing here is a layout algorithm:
 * the grid is the script's order and nothing moves.
 */
const PAIRS_SHOWN = 12
const PAIR_CHIPS = 4
const CELL = 12
const GAP = 9

export const PresenceView = ({
  projectId,
  shape,
  figures,
  index,
  map,
  episodes,
  selectedId,
  onShowAll,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  /** The records after the toolbar's filter. */
  readonly figures: readonly CastFigure[]
  readonly index: readonly SceneFacts[]
  readonly map: CharacterMap
  readonly episodes: number
  readonly selectedId: string | null
  readonly onShowAll: () => void
}) => {
  const rows = useMemo(() => figures.filter((figure) => figure.presence === 'present'), [figures])
  const shownMap = useMemo(() => mapOf(map, new Set(rows.map((row) => row.id))), [map, rows])
  const byId = useMemo(() => new Map(rows.map((figure) => [figure.id, figure])), [rows])
  const groups = useMemo(() => shownMap.columns.map((column) => byId.get(column.id)?.group ?? ('supporting' as CastGroup)), [byId, shownMap.columns])
  const refs = useMemo(() => new Map<NodeId, SceneFacts>(index.map((scene) => [scene.sceneNodeId, scene])), [index])
  const position = useMemo(() => new Map<NodeId, number>(index.map((scene, at) => [scene.sceneNodeId, at])), [index])
  const exchanges = useMemo(() => new Map<CharacterId, readonly ExchangeRow[]>(rows.map((row) => [row.id, row.exchanges])), [rows])
  const pairs = useMemo(() => sharedPairs(shownMap), [shownMap])
  const finding = useMemo(() => neverShare(shownMap, groups), [groups, shownMap])
  const silent = useMemo(() => silentPair(shownMap, exchanges, groups), [exchanges, groups, shownMap])
  const [allPairs, setAllPairs] = useState(false)
  const [hover, setHover] = useState<{ readonly scene: SceneFacts; readonly name: string; readonly state: string } | null>(null)

  const episodeGroups = useMemo(() => {
    const out: { ordinal: number; scenes: SceneFacts[] }[] = []
    for (const scene of index) {
      const last = out.at(-1)
      if (last !== undefined && last.ordinal === scene.episodeOrdinal) last.scenes.push(scene)
      else out.push({ ordinal: scene.episodeOrdinal, scenes: [scene] })
    }
    return out
  }, [index])

  if (rows.length === 0) {
    return (
      <div data-presence-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[24px]">
        {figures.length > 0 ? (
          <p className="m-0 text-12-5 text-ink3" data-presence-filtered-empty>
            Nobody in that filter is on the page.{' '}
            <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
              Show all
            </button>
          </p>
        ) : (
          <p className="m-0 text-12-5 text-ink3" data-presence-empty>
            Nobody is on the page yet. Presence is read from scenes; write one and the grid draws itself.
          </p>
        )}
      </div>
    )
  }

  const columns = `168px ${episodeGroups.map((group) => `repeat(${String(group.scenes.length)}, ${String(CELL)}px)`).join(` ${String(GAP)}px `)}`
  const strongest = pairs[0]?.shared ?? 1
  const shownPairs = allPairs ? pairs : pairs.slice(0, PAIRS_SHOWN)
  const a = finding === null ? null : shownMap.columns[finding[0]]
  const b = finding === null ? null : shownMap.columns[finding[1]]
  const sa = silent === null ? null : shownMap.columns[silent.a]
  const sb = silent === null ? null : shownMap.columns[silent.b]

  return (
    <div data-presence-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[24px]">
      <div className="flex flex-col gap-[14px]">
        <div role="table" aria-label="Presence by scene" className="folio-presence-grid" style={{ gridTemplateColumns: columns, columnGap: 0 }}>
          <div role="row" className="contents">
            <span role="columnheader" className="folio-presence-head folio-presence-name" style={{ zIndex: 4 }} />
            {episodeGroups.map((group, at) => (
              <span
                key={group.ordinal}
                role="columnheader"
                data-presence-episode={`E${String(group.ordinal)}`}
                title={`${String(group.scenes.length)} ${group.scenes.length === 1 ? 'scene' : 'scenes'}`}
                className="folio-presence-head folio-eyebrow pb-[4px]"
                style={{ gridColumn: `span ${String(group.scenes.length + (at < episodeGroups.length - 1 ? 1 : 0))}` }}
              >
                E{group.ordinal}
              </span>
            ))}
          </div>
          {rows.map((figure) => {
            const strip = figure.strip
            return (
              <div
                key={figure.id}
                role="row"
                data-presence-row={figure.id}
                aria-current={figure.id === selectedId ? 'true' : undefined}
                aria-label={`${figure.name} · ${String(figure.speaks)} speaks · ${String(figure.mentionedIn)} mentioned`}
                className="folio-presence-row contents"
              >
                <Link href={characterHref(projectId, figure.id)} className="folio-presence-name" data-presence-name>
                  <IdentityChip initial={figure.initial} hue={figure.hue} size={16} shape="square" />
                  <span className="min-w-0 flex-1 truncate text-12-5">{figure.name}</span>
                  <span className="tabular flex-none font-mono text-10-5 text-ink3">{figure.appearances} sc</span>
                </Link>
                {episodeGroups.map((group, at) => (
                  <span key={group.ordinal} className="contents">
                    {group.scenes.map((scene) => {
                      const state = strip[position.get(scene.sceneNodeId) ?? -1] ?? 'absent'
                      return (
                        <span
                          key={scene.sceneNodeId}
                          role="cell"
                          className="folio-presence-cell"
                          data-state={state}
                          data-scene={scene.sceneNodeId}
                          title={`${formatSceneRef(scene)} · ${scene.heading === '' ? 'No heading yet' : scene.heading} · ${state}`}
                          onMouseEnter={() => {
                            setHover({ scene, name: figure.name, state })
                          }}
                          onMouseLeave={() => {
                            setHover(null)
                          }}
                        />
                      )
                    })}
                    {at < episodeGroups.length - 1 ? <span className="folio-presence-gap" style={{ width: GAP }} /> : null}
                  </span>
                ))}
              </div>
            )
          })}
        </div>

        <div className="flex min-h-[20px] flex-wrap items-center gap-[10px] text-11 text-ink3" data-presence-hover={hover === null ? 'none' : hover.scene.sceneNodeId}>
          {hover === null ? (
            <>
              <span className="flex items-center gap-[5px]">
                <span className="folio-presence-cell" data-state="speaks" style={{ width: 10, height: 10 }} /> speaks
              </span>
              <span className="flex items-center gap-[5px]">
                <span className="folio-presence-cell" data-state="mentioned" style={{ width: 10, height: 10 }} /> mentioned
              </span>
              <span className="flex items-center gap-[5px]">
                <span className="folio-presence-cell" data-state="absent" style={{ width: 10, height: 10 }} /> absent
              </span>
            </>
          ) : (
            <>
              <CitationChips refs={[citeOf(projectId, shape, hover.scene)]} />
              <span className="min-w-0 truncate text-12 text-ink2">{hover.scene.heading === '' ? 'No heading yet' : hover.scene.heading}</span>
              <span className="text-12">
                {hover.name} · {hover.state}
              </span>
            </>
          )}
        </div>

        <section data-presence-pairs={pairs.length} className="flex flex-col gap-[8px] rounded-card border border-line2 bg-s1 px-[14px] py-[12px]">
          <div className="flex items-baseline gap-[8px]">
            <span className="folio-eyebrow flex-1">Pairs</span>
            <span className="text-11 text-ink3">scenes shared</span>
          </div>
          {pairs.length === 0 ? (
            <span className="text-12-5 text-ink3">No two characters share a scene yet.</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
              {shownPairs.map((pair) => {
                const x = shownMap.columns[pair.a]
                const y = shownMap.columns[pair.b]
                const fx = x === undefined ? undefined : byId.get(x.id)
                const fy = y === undefined ? undefined : byId.get(y.id)
                if (fx === undefined || fy === undefined) return null
                const shared = sharedRefs(fx.scenes, fy.scenes, refs).slice(0, PAIR_CHIPS)
                return (
                  <li key={`${fx.id}:${fy.id}`} data-presence-pair={`${fx.id}:${fy.id}`} className="flex flex-wrap items-center gap-[10px]">
                    <span className="flex flex-none items-center gap-[3px]">
                      <IdentityChip initial={fx.initial} hue={fx.hue} size={14} shape="square" />
                      <IdentityChip initial={fy.initial} hue={fy.hue} size={14} shape="square" />
                    </span>
                    <span className="w-[200px] min-w-0 truncate text-12-5">
                      {fx.name} · {fy.name}
                    </span>
                    <span className="folio-share-bar" style={{ width: 120 }}>
                      <span style={{ width: `${String(Math.round((pair.shared / strongest) * 100))}%` }} />
                    </span>
                    <span className="tabular w-[44px] flex-none font-mono text-10-5 text-ink3">{pair.shared} sc</span>
                    <CitationChips refs={shared.map((ref) => citeOf(projectId, shape, ref))} />
                  </li>
                )
              })}
            </ul>
          )}
          {pairs.length > PAIRS_SHOWN ? (
            <button
              type="button"
              data-presence-more-pairs
              onClick={() => {
                setAllPairs((value) => !value)
              }}
              className="self-start text-11 text-ink3 hover:text-ink2 hover:underline"
            >
              {allPairs ? 'Show fewer' : `+ ${String(pairs.length - PAIRS_SHOWN)} more pairs`}
            </button>
          ) : null}
        </section>

        {a !== undefined && b !== undefined && a !== null && b !== null ? (
          <div data-presence-finding="never-share" className="flex items-start gap-[12px] rounded-card border border-line2 bg-s1 px-[14px] py-[12px]">
            <span className="mt-[6px] h-[7px] w-[7px] flex-none rounded-full bg-warn" />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-13-5 font-medium tracking-title">
                {a.name} and {b.name} never share a scene.
              </span>
              <span className="text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
                Two principals - {a.scenes} and {b.scenes} scenes - with no contact across {episodes} {episodes === 1 ? 'episode' : 'episodes'}.
              </span>
            </div>
            <Link href={projectRouteHref(projectId, 'timeline')} className="flex-none pt-[2px] text-12">
              Timeline →
            </Link>
          </div>
        ) : null}

        {silent !== null && sa !== undefined && sb !== undefined && sa !== null && sb !== null ? (
          <div data-presence-finding="silent-pair" className="flex items-start gap-[12px] rounded-card border border-line2 bg-s1 px-[14px] py-[12px]">
            <span className="mt-[6px] h-[7px] w-[7px] flex-none rounded-full bg-warn" />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-13-5 font-medium tracking-title">
                {sa.name} and {sb.name} share {silent.shared} scenes but only speak to each other in {silent.talk}.
              </span>
              <span className="text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
                Counted from the cues: an exchange is two of them speaking in turn under one heading.
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
