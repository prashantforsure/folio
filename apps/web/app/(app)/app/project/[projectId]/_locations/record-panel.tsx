'use client'

import type { LocationRecordView, LocationRow, ProjectId } from '@folio/contracts'
import { IdentityChip } from '@folio/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { formatSceneRef, initialOf } from '../../../../../../lib/characters/figures'
import { deleteLocation, mergeLocations } from '../../../../../../lib/locations/actions'
import { ABSENT, eighths } from '../../../../../../lib/workspace/format'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { DayNightBar } from './day-night-bar'
import type { ElsewhereLinks, Run } from './locations-workspace'

/**
 * The record's right-hand column, 264px: `At a glance` and `Downstream`,
 * then `Merge into…` and `Delete`.
 *
 * `Route - Locations.dc.html`, the record's `<aside>`. Every figure under
 * "At a glance" is derived or measured: scenes from the roll-up, pages from
 * the measurement record summed over the set's scenes (`—` while nothing
 * is measured), first and last seen from the scene index, the day/night
 * split from the roll-up, the bars per episode from the same. "Screen time
 * by episode" is in pages when the episodes are measured and in scenes
 * when they are not, and the label says which.
 *
 * "Downstream" links to Storyboard and Production, where the set's frames
 * and plates are made. The bundle's `Establishing plate · E1 done` and
 * `Night plate · not yet` are a plate concept nothing here has; the two
 * rows are not drawn with invented states. Flagged.
 *
 * `Delete` is enabled only for a record the script no longer holds
 * (`presence: absent`); its title says why otherwise. A record deleted under
 * a live heading would be minted again on the next pass.
 */
export const RecordPanel = ({
  projectId,
  record,
  rows,
  baseHref,
  links,
  run,
}: {
  readonly projectId: ProjectId
  readonly record: LocationRecordView
  readonly rows: readonly LocationRow[]
  readonly baseHref: ProjectRoutePath
  readonly links: ElsewhereLinks
  readonly run: Run
}) => {
  const router = useRouter()
  const [merging, setMerging] = useState(false)
  const [winner, setWinner] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const measured = record.perEpisode.some((bar) => bar.eighths !== null)
  const heights = record.perEpisode.map((bar) => (measured ? (bar.eighths ?? 0) : bar.scenes))
  const max = Math.max(1, ...heights)

  const merge = (): void => {
    if (winner === '') return
    run(async () => {
      const result = await mergeLocations(projectId, record.id, winner)
      if (result.status !== 'merged') return result.message
      router.push(locationHref(projectId, result.into))
      return null
    })
  }

  const remove = (): void => {
    run(async () => {
      const result = await deleteLocation(projectId, record.id)
      if (result.status !== 'deleted') return result.message
      router.push(baseHref)
      return null
    })
  }

  return (
    <aside data-record-panel className="flex w-[264px] flex-none flex-col overflow-auto border-l border-line bg-panel">
      <div className="border-b border-line2 px-[14px] pb-[10px] pt-[12px] text-9-5 font-semibold uppercase tracking-label text-ink3">
        At a glance
      </div>
      <div className="flex flex-col gap-[14px] px-[14px] py-[12px]">
        <div className="grid grid-cols-2 gap-[10px]">
          {[
            { k: 'Scenes', v: String(record.rollup.scenes) },
            { k: 'Pages', v: eighths(record.eighths) },
            { k: 'First seen', v: record.firstSeen === null ? ABSENT : formatSceneRef(record.firstSeen) },
            { k: 'Last seen', v: record.lastSeen === null ? ABSENT : formatSceneRef(record.lastSeen) },
          ].map((fact) => (
            <div key={fact.k} className="flex flex-col gap-[2px]" data-fact={fact.k}>
              <span className="text-9-5 text-ink3">{fact.k}</span>
              <span className="tabular text-13 font-medium">{fact.v}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-[6px]">
          <div className="flex justify-between text-10 text-ink3">
            <span>Day / night</span>
            <span className="tabular" data-day-night-split>
              {record.rollup.dayScenes} / {record.rollup.nightScenes}
            </span>
          </div>
          <DayNightBar
            scenes={record.rollup.scenes}
            dayScenes={record.rollup.dayScenes}
            nightScenes={record.rollup.nightScenes}
            className="w-full"
          />
        </div>

        <div className="flex flex-col gap-[6px]">
          <div className="flex justify-between text-10 text-ink3">
            <span>Screen time by episode</span>
            <span>{measured ? 'pages' : 'scenes'}</span>
          </div>
          <div className="flex h-[44px] items-end gap-[4px]">
            {record.perEpisode.map((bar, index) => {
              const value = heights[index] ?? 0
              return (
                <div key={bar.episode} className="flex h-full flex-1 flex-col items-center justify-end gap-[3px]">
                  <span
                    title={measured ? `${eighths(bar.eighths)} pages` : `${String(bar.scenes)} ${bar.scenes === 1 ? 'scene' : 'scenes'}`}
                    className={`w-full rounded-t-[2px] ${value > 0 ? 'bg-ink2' : 'bg-line'}`}
                    style={{ height: `${String(value > 0 ? Math.max(8, Math.round((value / max) * 100)) : 2)}%` }}
                  />
                  <span className="text-9 text-ink3">E{bar.ordinal}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-[6px]" data-people={record.people.length}>
          <span className="text-10 text-ink3">Who is here most</span>
          {record.people.length === 0 ? <span className="text-11 text-ink3">No one yet.</span> : null}
          {record.people.map((person) => (
            <div key={person.id} className="flex items-center gap-[8px]">
              <IdentityChip initial={initialOf(person.name)} hue={person.hue} size={18} />
              <span className="flex-1 text-11-5">{person.name}</span>
              <span className="tabular text-10-5 text-ink3">{person.scenes} sc</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-[4px]">
          <div className="flex justify-between text-10 text-ink3">
            <span>Shooting days scheduled</span>
            <span className="tabular" data-shooting-days>
              {record.rollup.shootingDays}
            </span>
          </div>
          <span className="text-10 text-ink3">
            {record.rollup.shootingDays === record.own.shootingDays
              ? 'Set in Production, counted by set.'
              : `${String(record.own.shootingDays)} here, the rest in sub-locations.`}
          </span>
        </div>
      </div>

      <div className="border-b border-t border-line2 px-[14px] pb-[10px] pt-[12px] text-9-5 font-semibold uppercase tracking-label text-ink3">
        Downstream
      </div>
      <div className="flex flex-col gap-[8px] px-[14px] py-[12px]">
        <span className="text-10-5 text-ink3">Frames and plates for this set are made where the scenes are boarded and shot.</span>
        {links.storyboard === null ? null : (
          <Link href={links.storyboard} className="mt-[2px] text-11">
            Open in Storyboard →
          </Link>
        )}
        {links.production === null ? null : (
          <Link href={links.production} className="text-11">
            Open in Production →
          </Link>
        )}
        <Link href={links.characters} className="text-11">
          Who is here, in Characters →
        </Link>
      </div>

      <div className="flex-1" />

      {merging ? (
        <form
          data-merge-form
          onSubmit={(event) => {
            event.preventDefault()
            merge()
          }}
          className="flex flex-col gap-[6px] border-t border-line2 px-[14px] py-[10px]"
        >
          <span className="text-10-5 text-ink2">
            Merge {record.name} into another record. Its sluglines and sub-locations move; this record becomes a pointer.
          </span>
          <select
            autoFocus
            value={winner}
            onChange={(event) => {
              setWinner(event.target.value)
            }}
            aria-label="Merge into"
            data-merge-into
            className="w-full rounded-chrome border border-line2 bg-sheet px-[8px] py-[4px] text-11-5 text-ink outline-none"
          >
            <option value="">Pick a location</option>
            {rows
              .filter((row) => row.id !== record.id)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.parentId === null ? row.name : `— ${row.name}`}
                </option>
              ))}
          </select>
          <span className="flex gap-[6px]">
            <button
              type="submit"
              disabled={winner === ''}
              className="flex-1 rounded-chrome border-none bg-ink px-[9px] py-[5px] text-11 font-semibold text-desk disabled:opacity-50"
            >
              Merge
            </button>
            <button
              type="button"
              onClick={() => {
                setMerging(false)
              }}
              className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover"
            >
              Cancel
            </button>
          </span>
        </form>
      ) : confirmDelete ? (
        <div className="flex flex-col gap-[6px] border-t border-line2 px-[14px] py-[10px]" data-delete-confirm>
          <span className="text-10-5 text-ink2">
            Delete {record.name}? Its notes and bound sluglines go with it; its sub-locations move up a level.
          </span>
          <span className="flex gap-[6px]">
            <button
              type="button"
              onClick={remove}
              data-delete-forever
              className="flex-1 rounded-chrome border-none bg-del px-[9px] py-[5px] text-11 font-semibold text-accent-ink"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(false)
              }}
              className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover"
            >
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <div className="flex gap-[6px] border-t border-line2 px-[14px] py-[10px]">
          <button
            type="button"
            onClick={() => {
              setWinner('')
              setMerging(true)
            }}
            data-merge-button
            className="flex-1 rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink"
          >
            Merge into…
          </button>
          <button
            type="button"
            disabled={record.presence === 'present'}
            title={
              record.presence === 'present'
                ? 'Still in the script. Change its headings first, or merge the record.'
                : 'Delete this record'
            }
            onClick={() => {
              setConfirmDelete(true)
            }}
            data-delete-button
            className="flex-none rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink3 hover:bg-del-bg hover:text-del disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </aside>
  )
}
