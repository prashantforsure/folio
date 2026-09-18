'use client'

import type { LocationRow, ProjectId, SceneRef, StructureResolveItem } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import { EpisodeBars, PRESENCE_STRIP_LIMIT, PresenceStrip } from '@folio/ui'
import Link from 'next/link'
import { useState } from 'react'

import { citeOf } from '../../../../../../lib/characters/figures'
import { resolveStructure, uploadLocationPhoto } from '../../../../../../lib/locations/actions'
import { dayNightShort, metaLine, stripGroupsOf } from '../../../../../../lib/locations/view'
import { eighths } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref, locationHref } from '../../../../../../lib/workspace/hrefs'
import { ConflictBlock } from '../_chrome/conflict-block'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { CastStack, StatusDot, Thumb } from './set-parts'
import type { EpisodeRow } from './locations-workspace'

/**
 * One location as the rebuild draws it (2026-09-18, the plan is the spec):
 * content first, the picture second. A `--s1` card on `.folio-record-card`
 * whose head is the 28px thumbnail (a photo when there is one, the hue
 * mark otherwise - never a 16:10 tile), the status dot, and the name as
 * the stretched link (`.folio-record-link`, so the whole card opens the
 * drawer and a middle-click opens a tab) over `INT/EXT · 4 D · 5 N` in
 * mono; then what the page says about the place - the establishing line
 * quoted, or the description; then, on a primary set, the `Inside` strip
 * of its sub-sets with their counts, each a link; the conflict block; the
 * presence strip across the script; and the foot: `9 sc · 41 2/8 pp`, the
 * span as linked chips, the cast with `+N`.
 *
 * Interactive pieces inside the card sit above the stretched link on
 * `[data-raised]` (the CSS), so a chip, an avatar or a conflict button is
 * its own click. `Drop a photo` is still real: a file dropped anywhere on
 * the card uploads as the photo, with storage configured (`data-over`
 * draws the dashed outline).
 */
export const LocationCard = ({
  projectId,
  shape,
  row,
  subSets,
  index,
  episodes,
  selected,
  storage,
  run,
  toast,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly row: LocationRow
  /** This record's sub-sets, in tree order - the `Inside` strip. */
  readonly subSets: readonly LocationRow[]
  readonly index: readonly SceneRef[]
  readonly episodes: readonly EpisodeRow[]
  readonly selected: boolean
  readonly storage: boolean
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
}) => {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const href = locationHref(projectId, row.id)
  const conflict = row.conflicts[0]
  const here = new Set(row.scenes.map((scene) => scene.scene.sceneNodeId))
  const onPage = row.rollup.scenes > 0

  const upload = (file: File): void => {
    if (!PORTRAIT_TYPES.includes(file.type as (typeof PORTRAIT_TYPES)[number])) return
    run(async () => {
      const form = new FormData()
      form.set('photo', file)
      const result = await uploadLocationPhoto(projectId, row.id, form)
      return result.status === 'saved' ? null : result.message
    })
  }

  const decide = (item: StructureResolveItem, choice: 'accept' | 'reject'): void => {
    setBusy(true)
    run(async () => {
      const result = await resolveStructure(projectId, item.key, { kind: choice })
      setBusy(false)
      if (result.status !== 'resolved') return result.message
      const parentName = item.proposal.kind === 'attach' ? item.proposal.parent.name : item.proposal.name
      toast(choice === 'accept' ? `${row.name} is inside ${parentName} now.` : `${row.name} stays a set of its own.`)
      return null
    })
  }

  const first = row.firstSeen === null ? null : citeOf(projectId, shape, row.firstSeen)
  const last = row.lastSeen === null ? null : citeOf(projectId, shape, row.lastSeen)
  const line = row.intro?.text ?? row.description

  return (
    <article
      data-location-card={row.id}
      data-status={row.status}
      data-kind={row.kind}
      data-conflict={conflict === undefined ? 'false' : 'true'}
      data-over={over ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
      className="folio-record-card"
      onDragOver={(event) => {
        if (!storage) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setOver(false)
      }}
      onDrop={(event) => {
        if (!storage) return
        event.preventDefault()
        setOver(false)
        const file = event.dataTransfer.files[0]
        if (file !== undefined) upload(file)
      }}
    >
      <div className="flex items-start gap-[10px]">
        <span className="flex-none pt-[1px]" data-card-thumb={row.photoUrl === null ? 'mark' : 'photo'}>
          <Thumb id={row.id} name={row.name} photoUrl={row.photoUrl} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="flex min-w-0 items-center gap-[7px]">
            <StatusDot status={row.status} attr="data-card-status" />
            <Link href={href} className="folio-record-link min-w-0 truncate text-14-5 font-medium tracking-title" data-card-link data-card-name>
              {row.name}
            </Link>
          </span>
          <span className="truncate font-mono text-10-5 text-ink3" data-card-kind>
            {row.ie ?? '—'} · {dayNightShort(row.rollupQuadrant)}
            {row.parent === null ? null : <span className="text-ink3"> · inside {row.parent.name}</span>}
          </span>
        </span>
      </div>

      <p className={`m-0 line-clamp-2 text-12-5 leading-[1.5] ${line === null ? 'text-ink3' : 'text-ink2'}`} style={{ textWrap: 'pretty' }} data-card-line={row.intro === null ? (row.description === null ? 'none' : 'description') : 'intro'}>
        {line ?? (onPage ? 'Nothing written about it yet.' : 'Not on the page yet')}
      </p>

      {subSets.length === 0 ? null : (
        <span className="flex flex-wrap items-center gap-[4px]" data-card-inside={subSets.length}>
          <span className="folio-eyebrow mr-[2px]">Inside</span>
          {subSets.map((sub) => (
            <Link
              key={sub.id}
              href={locationHref(projectId, sub.id)}
              data-raised
              data-card-sub={sub.id}
              className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline"
              title={`${sub.name} · ${String(sub.rollup.scenes)} ${sub.rollup.scenes === 1 ? 'scene' : 'scenes'}`}
            >
              {sub.name} {sub.rollup.scenes}
            </Link>
          ))}
        </span>
      )}

      {conflict === undefined ? null : (
        <div data-raised>
          <ConflictBlock
            title={
              conflict.proposal.kind === 'attach'
                ? `${row.name} reads like part of ${conflict.proposal.parent.name}.`
                : `${row.name} reads like part of a set called ${conflict.proposal.name}.`
            }
            detail={
              conflict.proposal.kind === 'attach'
                ? `${String(conflict.scenes)} ${conflict.scenes === 1 ? 'heading names' : 'headings name'} it that way. Moving it inside counts its scenes in ${conflict.proposal.parent.name}'s total; the script is not changed.`
                : `${String(conflict.scenes)} ${conflict.scenes === 1 ? 'heading names' : 'headings name'} it that way. Moving it inside makes ${conflict.proposal.name} a primary set with this one under it; the script is not changed.`
            }
            accept="Move it inside"
            busy={busy}
            onAccept={() => {
              decide(conflict, 'accept')
            }}
            onDeliberate={() => {
              decide(conflict, 'reject')
            }}
          />
        </div>
      )}

      {onPage ? (
        index.length <= PRESENCE_STRIP_LIMIT.card ? (
          <PresenceStrip groups={stripGroupsOf(here, index, episodes)} size="card" className="mt-[2px]" />
        ) : (
          <EpisodeBars counts={row.perEpisode} />
        )
      ) : null}

      <div className="mt-auto flex min-w-0 items-center gap-[8px] pt-[2px]">
        <span className="tabular min-w-0 flex-1 truncate font-mono text-10-5 text-ink3" data-card-scenes>
          {onPage ? `${String(row.rollup.scenes)} sc · ${eighths(row.eighths)} pp` : metaLine(row)}
        </span>
        {first === null || last === null ? null : (
          <span className="flex flex-none items-center gap-[4px]" data-card-span data-raised>
            <Link href={first.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
              {first.label}
            </Link>
            {first.href === last.href ? null : (
              <>
                <span className="text-10 text-ink3">→</span>
                <Link href={last.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                  {last.label}
                </Link>
              </>
            )}
          </span>
        )}
        <CastStack people={row.people} attr="data-card-cast" hrefOf={(id) => characterHref(projectId, id)} />
      </div>
    </article>
  )
}
