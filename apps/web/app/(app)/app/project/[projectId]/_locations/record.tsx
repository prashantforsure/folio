'use client'

import type { LocationRecordView, LocationRow, ProjectId } from '@folio/contracts'
import { canonicalKey, readSlugline } from '@folio/script'
import { Editable } from '@folio/ui'
import Link from 'next/link'
import { useState } from 'react'

import {
  bindSluglineAlias,
  renameLocation,
  saveArcNote,
  saveLocation,
  setParent,
  unbindSluglineAlias,
} from '../../../../../../lib/locations/actions'
import { kindOf, subtreeOf } from '../../../../../../lib/locations/figures'
import { ABSENT, eighths } from '../../../../../../lib/workspace/format'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { DayNightBar } from './day-night-bar'
import { NewLocationButton } from './location-nav'
import type { ElsewhereLinks, EpisodeHead, Run } from './locations-workspace'
import { RecordPanel } from './record-panel'

/**
 * One location's record: the 820px column and the 264px panel.
 *
 * `Route - Locations.dc.html`, `isRecord`, section by section, and what
 * each is made of:
 *
 *   head             parent › I/E · kind, the name in Newsreader 34px (an
 *                    `h2`: the route's `h1` is "Locations"), the alias table
 *                    - every counted heading with its count (derived), every
 *                    bound set text not in the script at `× 0`, `＋ alias`
 *                    to bind another, `×` to unbind. The name's edit is a
 *                    **rename** and asks first (below). `Inside` is the tree
 *                    edge, authored: a select over the primary sets
 *   Description      authored, in Newsreader; the reference box says why it
 *                    does nothing
 *   Inside this      the sub-sets as cards with their own counts, and
 *   location         `＋ Sub-location`, which creates a record under this one
 *   Scenes here      every scene at this set or below, in reading order,
 *                    filtered by episode or light: episode · Sc · heading
 *                    and synopsis · day/night · cast · eighths
 *   How this place   one authored note per episode - the spec's "arc note
 *   changes          per episode"
 *   the panel        `RecordPanel`
 *
 * ## The rename asks first
 *
 * Editing the name shows what it will do before it does it: "Rename
 * everywhere? N headings will be rewritten across the script." Confirming
 * runs `renameLocation` - the second sanctioned write-back, every heading
 * whose set *is* the name in every episode, a `before_rename` version per
 * script touched - and the diff comes back as the count. AGENTS.md, Entity
 * identity: "Renaming a location rewrites every scene heading that uses it
 * ... an explicit operation with an undo entry."
 */
export const Record = ({
  projectId,
  record,
  rows,
  episodes,
  baseHref,
  links,
  run,
}: {
  readonly projectId: ProjectId
  readonly record: LocationRecordView
  /** Every record in tree order, for the parent picker and the merge picker. */
  readonly rows: readonly LocationRow[]
  readonly episodes: readonly EpisodeHead[]
  readonly baseHref: ProjectRoutePath
  readonly links: ElsewhereLinks
  readonly run: Run
}) => {
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [renamed, setRenamed] = useState<string | null>(null)
  const [aliasOpen, setAliasOpen] = useState(false)
  const [alias, setAlias] = useState('')
  const [filter, setFilter] = useState<'all' | 'day' | 'night' | number>('all')

  const field = (edit: Record<string, unknown>): void => {
    run(async () => {
      const result = await saveLocation(projectId, record.id, edit)
      return result.status === 'saved' ? null : result.message
    })
  }

  const rename = (): void => {
    const next = pendingName
    if (next === null) return
    setPendingName(null)
    run(async () => {
      const result = await renameLocation(projectId, record.id, next)
      if (result.status !== 'renamed') return result.message
      setRenamed(
        result.headings === 0
          ? 'Renamed. No heading carried the old name.'
          : `Renamed. ${String(result.headings)} ${result.headings === 1 ? 'heading' : 'headings'} rewritten across ${String(
              result.episodes,
            )} ${result.episodes === 1 ? 'episode' : 'episodes'}.`,
      )
      return null
    })
  }

  const bind = (): void => {
    const set = alias.trim()
    if (set === '') return
    setAlias('')
    setAliasOpen(false)
    run(async () => {
      const result = await bindSluglineAlias(projectId, record.id, set)
      return result.status === 'bound' ? null : result.message
    })
  }

  const unbind = (set: string): void => {
    run(async () => {
      const result = await unbindSluglineAlias(projectId, record.id, set)
      return result.status === 'saved' ? null : result.message
    })
  }

  const hang = (parent: string): void => {
    run(async () => {
      const result = await setParent(projectId, record.id, parent === '' ? null : parent)
      return result.status === 'saved' ? null : result.message
    })
  }

  const note = (episodeId: string, text: string): void => {
    run(async () => {
      const result = await saveArcNote(projectId, record.id, { episodeId, text })
      return result.status === 'saved' ? null : result.message
    })
  }

  // The alias table's two halves: what the script counts, and what the
  // writer bound that the script does not (yet) contain. A counted heading
  // is `INT. X - DAY`; a bound set text is `X`, so the bound half is shown
  // as the set texts the counted headings do not already cover.
  const countedKeys = new Set(
    record.sluglines.map((row) => {
      const read = readSlugline(row.slugline)
      return read.ok ? canonicalKey(read.value.set) : ''
    }),
  )
  const uncounted = record.boundSluglines.filter((set) => !countedKeys.has(canonicalKey(set)))
  const subtree = subtreeOf(record.id, rows)
  const parents = rows.filter((row) => !subtree.has(row.id))

  const shownScenes = record.scenes.filter((row) =>
    filter === 'all'
      ? true
      : filter === 'day' || filter === 'night'
        ? row.light === filter
        : row.scene.episodeOrdinal === filter,
  )
  const episodesHere = new Set(record.scenes.map((row) => row.scene.episodeOrdinal)).size
  const filters: readonly { readonly id: 'all' | 'day' | 'night' | number; readonly label: string }[] = [
    { id: 'all', label: 'All' },
    ...episodes.filter((episode) => record.perEpisode.some((bar) => bar.ordinal === episode.ordinal && bar.scenes > 0)).map((episode) => ({ id: episode.ordinal, label: `E${String(episode.ordinal)}` })),
    { id: 'day', label: 'Day' },
    { id: 'night', label: 'Night' },
  ]

  return (
    <>
      <div className="min-w-0 flex-1 overflow-auto px-[26px] pb-[60px] pt-[22px]" data-location-record={record.id}>
        <div className="flex max-w-[820px] flex-col gap-[22px]">
          {/* head */}
          <div className="flex flex-col gap-[8px]">
            <div className="flex flex-wrap items-center gap-[8px] text-11 text-ink3">
              {record.parent === null ? null : (
                <>
                  <Link href={locationHref(projectId, record.parent.id)} className="text-accent" data-parent-link>
                    {record.parent.name}
                  </Link>
                  <span>›</span>
                </>
              )}
              <span className="rounded-chrome border border-line2 px-[6px] py-[1px] text-9-5 font-semibold tracking-[.06em]" data-ie>
                {record.ie ?? ABSENT}
              </span>
              <span data-kind>{kindOf(record)}</span>
              <span className="flex-1" />
              <label className="flex items-center gap-[6px]">
                <span>Inside</span>
                <select
                  value={record.parent?.id ?? ''}
                  onChange={(event) => {
                    hang(event.target.value)
                  }}
                  aria-label="Inside"
                  data-parent-select
                  className="rounded-chrome border border-line2 bg-transparent px-[6px] py-[1px] text-10-5 text-ink2 outline-none"
                >
                  <option value="">— a primary set —</option>
                  {parents.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.parentId === null ? row.name : `— ${row.name}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {pendingName === null ? (
              <h2 className="m-0 font-serif text-34 font-medium leading-[1.05] tracking-[-.015em]">
                <Editable
                  value={record.name}
                  placeholder="Name"
                  label="Name"
                  onSave={(next) => {
                    if (next !== '' && next !== record.name) setPendingName(next)
                  }}
                  className="font-serif text-34 font-medium leading-[1.05] tracking-[-.015em]"
                />
              </h2>
            ) : (
              <div className="flex flex-col gap-[6px] rounded-chrome border border-note bg-note-bg px-[12px] py-[10px]" data-rename-confirm>
                <span className="font-serif text-15">
                  Rename {record.name} to {pendingName} everywhere?
                </span>
                <span className="text-11 text-ink2">
                  {record.nameHeadings === 0
                    ? 'No heading in the script carries this name; only the record changes.'
                    : `${String(record.nameHeadings)} ${
                        record.nameHeadings === 1 ? 'heading' : 'headings'
                      } will be rewritten across the script. Other set texts bound to this record stay as they are.`}
                </span>
                <span className="flex gap-[6px]">
                  <button
                    type="button"
                    onClick={rename}
                    data-rename-everywhere
                    className="rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11-5 font-semibold text-desk"
                  >
                    Rename everywhere
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingName(null)
                    }}
                    className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11-5 text-ink2 hover:bg-hover"
                  >
                    Cancel
                  </button>
                </span>
              </div>
            )}
            {renamed === null ? null : (
              <span className="text-10-5 text-add" data-renamed>
                {renamed}
              </span>
            )}

            <div className="flex flex-wrap items-center gap-[6px]" data-sluglines>
              <span className="mr-[2px] text-10 text-ink3">Sluglines that resolve here</span>
              {record.sluglines.map((row) => (
                <span
                  key={row.slugline}
                  data-slugline-chip={row.slugline}
                  className="inline-flex items-center gap-[6px] rounded-chrome border border-line2 bg-sheet px-[8px] py-[2px] font-mono text-10-5 text-ink2"
                >
                  {row.slugline}
                  <span className="text-ink3">× {row.occurrences}</span>
                </span>
              ))}
              {uncounted.map((set) => (
                <span
                  key={set}
                  data-slugline-chip={set}
                  className="inline-flex items-center gap-[6px] rounded-chrome border border-dashed border-line2 bg-sheet px-[8px] py-[2px] font-mono text-10-5 text-ink2"
                >
                  {set}
                  <span className="text-ink3">× 0</span>
                  <button
                    type="button"
                    title="Unbind this set text"
                    aria-label={`Unbind ${set}`}
                    onClick={() => {
                      unbind(set)
                    }}
                    className="border-none bg-transparent p-0 text-10 text-ink3 hover:text-del"
                  >
                    ×
                  </button>
                </span>
              ))}
              {aliasOpen ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    bind()
                  }}
                  className="flex items-center gap-[4px]"
                >
                  <input
                    autoFocus
                    type="text"
                    value={alias}
                    onChange={(event) => {
                      setAlias(event.target.value)
                    }}
                    onBlur={() => {
                      if (alias.trim() === '') setAliasOpen(false)
                    }}
                    placeholder="Another set text"
                    aria-label="Another set text"
                    data-alias-input
                    className="w-[170px] rounded-chrome border border-accent-line bg-sheet px-[8px] py-[2px] font-mono text-10-5 text-ink outline-none placeholder:text-ink3"
                  />
                  <button
                    type="submit"
                    className="rounded-chrome border-none bg-ink px-[8px] py-[3px] text-10-5 font-semibold text-desk"
                  >
                    Bind
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAliasOpen(true)
                  }}
                  data-add-alias
                  className="rounded-chrome border border-dashed border-line bg-transparent px-[8px] py-[2px] text-10-5 text-ink3 hover:bg-hover hover:text-ink"
                >
                  ＋ alias
                </button>
              )}
            </div>
          </div>

          {/* description + reference */}
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(200px,1fr)] gap-[18px]">
            <div className="flex flex-col gap-[10px]">
              <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Description</span>
              <p className="m-0 font-serif text-[15.5px] leading-[1.55] text-ink">
                <Editable
                  value={record.description}
                  placeholder="Describe the place once: what it looks like, what it sounds like, what it costs to shoot there."
                  label="Description"
                  multiline
                  onSave={(next) => {
                    field({ description: next })
                  }}
                  className="font-serif text-[15.5px] leading-[1.55]"
                />
              </p>
            </div>
            <div className="flex flex-col gap-[8px]">
              <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Reference</span>
              <div
                title="Scouting photos need file storage, which is not built yet. Plates are generated in Production."
                className="flex aspect-[4/3] flex-col items-center justify-center gap-[4px] rounded-chrome border border-dashed border-line bg-hover p-[12px] text-center"
              >
                <span className="text-11-5 text-ink2">Drop a scouting photo</span>
                <span className="text-10 text-ink3">or generate a plate in Production</span>
              </div>
            </div>
          </div>

          {/* sub-locations */}
          {record.parent === null ? (
            <div className="flex flex-col gap-[8px]" data-sub-locations={record.subLocations.length}>
              <div className="flex items-baseline gap-[8px]">
                <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Inside this location</span>
                <span className="text-10-5 text-ink3">
                  {record.subLocations.length} · counted in the parent total
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[8px]">
                {record.subLocations.map((sub) => (
                  <Link
                    key={sub.id}
                    href={locationHref(projectId, sub.id)}
                    data-sub-location={sub.id}
                    className="flex flex-col gap-[5px] rounded-chrome border border-line2 bg-panel px-[11px] py-[9px] text-ink no-underline hover:border-accent-line hover:no-underline"
                  >
                    <span className="flex items-center gap-[6px]">
                      <span className="text-8-5 font-semibold tracking-[.06em] text-ink3">{sub.ie ?? ABSENT}</span>
                      <span className="min-w-0 flex-1 truncate text-12 font-medium">{sub.name}</span>
                    </span>
                    <span className="flex items-center gap-[6px]">
                      <DayNightBar
                        scenes={sub.rollup.scenes}
                        dayScenes={sub.rollup.dayScenes}
                        nightScenes={sub.rollup.nightScenes}
                        height={4}
                        className="min-w-0 flex-1"
                      />
                      <span className="tabular whitespace-nowrap text-10 text-ink3">{sub.rollup.scenes} sc</span>
                    </span>
                  </Link>
                ))}
                <NewLocationButton projectId={projectId} variant="dashed" parentId={record.id} label="Sub-location" />
              </div>
            </div>
          ) : null}

          {/* scenes here */}
          <div className="flex flex-col gap-[8px]">
            <div className="flex items-baseline gap-[8px]">
              <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Scenes here</span>
              <span className="text-10-5 text-ink3" data-scenes-here={record.scenes.length}>
                {record.scenes.length} across {episodesHere} {episodesHere === 1 ? 'episode' : 'episodes'}
              </span>
              <span className="flex-1" />
              <div className="flex gap-[2px] rounded-chrome border border-line2 p-[2px]" role="group" aria-label="Filter scenes">
                {filters.map((entry) => (
                  <button
                    key={String(entry.id)}
                    type="button"
                    onClick={() => {
                      setFilter(entry.id)
                    }}
                    aria-pressed={filter === entry.id}
                    className={`rounded-chrome border-none px-[8px] py-[2px] text-10-5 hover:text-ink ${
                      filter === entry.id ? 'bg-sel text-ink' : 'bg-transparent text-ink3'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-chrome border border-line bg-panel">
              {shownScenes.length === 0 ? (
                <div className="px-[14px] py-[12px] text-11-5 text-ink3">
                  {record.scenes.length === 0
                    ? 'No scene in the script is set here. The record is kept; write a heading and it appears.'
                    : 'No scene matches this filter.'}
                </div>
              ) : null}
              {shownScenes.map((row) => (
                <div
                  key={row.scene.sceneNodeId}
                  data-scene-row={row.scene.sceneNodeId}
                  className="grid grid-cols-[44px_40px_minmax(0,1fr)_60px_110px_36px] items-center gap-[12px] border-b border-line2 px-[14px] py-[9px] hover:bg-hover"
                >
                  <span className="tabular text-10-5 text-ink3">E{row.scene.episodeOrdinal}</span>
                  <span className="tabular text-11 text-ink2">Sc {row.scene.number}</span>
                  <span className="flex min-w-0 flex-col gap-[2px]">
                    <span className="truncate font-mono text-11-5">{row.scene.heading}</span>
                    <span className="truncate text-10-5 text-ink3">
                      {row.gist ?? (row.at.id === record.id ? '' : row.at.name)}
                    </span>
                  </span>
                  <span className="flex items-center gap-[5px] text-10 text-ink3">
                    <span
                      className={`h-[7px] w-[7px] rounded-sheet ${
                        row.light === 'day' ? 'bg-day' : row.light === 'night' ? 'bg-night' : 'bg-line'
                      }`}
                    />
                    {row.light === 'day' ? 'Day' : row.light === 'night' ? 'Night' : (row.timeOfDay ?? ABSENT)}
                  </span>
                  <span className="flex flex-wrap gap-[3px]">
                    {row.cast.slice(0, 3).map((person) => (
                      <span key={person.id} className="rounded-sheet bg-sel px-[5px] text-9-5 text-ink2">
                        {person.name}
                      </span>
                    ))}
                    {row.cast.length > 3 ? <span className="text-9-5 text-ink3">+{row.cast.length - 3}</span> : null}
                  </span>
                  <span className="text-right font-mono text-10 text-ink3">{eighths(row.eighths)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* arc notes */}
          <div className="flex flex-col gap-[8px]" data-arc>
            <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">How this place changes</span>
            <div className="flex flex-col border-l border-line">
              {record.arc.map((entry) => (
                <div key={entry.episodeId} data-arc-note={entry.episode} className="grid grid-cols-[52px_minmax(0,1fr)] gap-[12px] py-[6px] pl-[14px]">
                  <span className="tabular pt-[2px] text-10-5 text-ink3">E{entry.ordinal}</span>
                  <span className="font-serif text-14 leading-[1.5] text-ink">
                    <Editable
                      value={entry.text}
                      placeholder={
                        entry.ordinal === 1
                          ? 'Add a note about how this place reads when we first see it…'
                          : 'Add a note about how this place reads by the end…'
                      }
                      label={`Note for E${String(entry.ordinal)}`}
                      multiline
                      onSave={(next) => {
                        note(entry.episodeId, next)
                      }}
                      className="font-serif text-14 leading-[1.5]"
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <RecordPanel projectId={projectId} record={record} rows={rows} baseHref={baseHref} links={links} run={run} />
    </>
  )
}
