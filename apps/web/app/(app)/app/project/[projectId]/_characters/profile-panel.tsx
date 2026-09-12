'use client'

import type { CastRow, CharacterProfile, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { deleteCharacter, mergeCharacters } from '../../../../../../lib/characters/actions'
import { formatGap, formatSceneRef } from '../../../../../../lib/characters/figures'
import { ABSENT } from '../../../../../../lib/workspace/format'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { ElsewhereLinks, Run } from './characters-workspace'

/**
 * The profile's right-hand column, 264px: `On the page` and `Elsewhere`,
 * then `Merge into…` and `Delete`.
 *
 * `Route - Characters.dc.html`, the profile's `<aside>`. Every figure under
 * "On the page" is derived: scenes and lines from `character_derivations`,
 * first and last seen from the derived scene list against the scene
 * index, the bars from the same, the voice share from this record's lines
 * over every present scene's. The bundle's "Voice share · E1" is one
 * episode's; the figure here is project-wide and its label says so, because
 * per-episode line counts per character are not a stored fact and would
 * have to be walked from the nodes on every render. Flagged.
 *
 * "Elsewhere" links to the four routes the bundle names. Bible and Timeline
 * have no records yet, so their meta is `—` - a thing that either exists or
 * does not. Insights · Presence carries the computed gap. Production · cast
 * is `not yet`, the bundle's own copy for an uncast record.
 *
 * `Delete` is enabled only for a record the script no longer holds
 * (`presence: absent`); its title says why otherwise. A record deleted under
 * a live cue would be minted again on the next pass.
 */
export const ProfilePanel = ({
  projectId,
  profile,
  cast,
  baseHref,
  links,
  run,
}: {
  readonly projectId: ProjectId
  readonly profile: CharacterProfile
  readonly cast: readonly CastRow[]
  readonly baseHref: ProjectRoutePath
  readonly links: ElsewhereLinks
  readonly run: Run
}) => {
  const router = useRouter()
  const [merging, setMerging] = useState(false)
  const [winner, setWinner] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const max = Math.max(1, ...profile.perEpisode.map((bar) => bar.scenes))
  const gapNote = formatGap(profile.gap)
  const voicePct = profile.voiceShare === null ? null : Math.round(profile.voiceShare * 100)

  const merge = (): void => {
    if (winner === '') return
    run(async () => {
      const result = await mergeCharacters(projectId, profile.id, winner)
      if (result.status !== 'merged') return result.message
      router.push(characterHref(projectId, result.into))
      return null
    })
  }

  const remove = (): void => {
    run(async () => {
      const result = await deleteCharacter(projectId, profile.id)
      if (result.status !== 'deleted') return result.message
      router.push(baseHref)
      return null
    })
  }

  return (
    <aside
      data-profile-panel
      className="flex w-[264px] flex-none flex-col overflow-auto border-l border-line bg-panel"
    >
      <div className="border-b border-line2 px-[14px] pb-[10px] pt-[12px] text-9-5 font-semibold uppercase tracking-label text-ink3">
        On the page
      </div>
      <div className="flex flex-col gap-[14px] border-b border-line2 px-[14px] py-[12px]">
        <div className="grid grid-cols-2 gap-[10px]">
          {[
            { k: 'Scenes', v: String(profile.appearances) },
            { k: 'Lines', v: String(profile.lines) },
            { k: 'First seen', v: profile.firstSeen === null ? ABSENT : formatSceneRef(profile.firstSeen) },
            { k: 'Last seen', v: profile.lastSeen === null ? ABSENT : formatSceneRef(profile.lastSeen) },
          ].map((fact) => (
            <div key={fact.k} className="flex flex-col gap-[2px]" data-fact={fact.k}>
              <span className="text-9-5 text-ink3">{fact.k}</span>
              <span className="tabular text-13 font-medium">{fact.v}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-[6px]">
          <div className="flex justify-between text-10 text-ink3">
            <span>Scenes by episode</span>
            <span data-gap-note>{gapNote}</span>
          </div>
          <div className="flex h-[44px] items-end gap-[4px]">
            {profile.perEpisode.map((bar) => (
              <div key={bar.episode} className="flex h-full flex-1 flex-col items-center justify-end gap-[3px]">
                <span
                  title={`${String(bar.scenes)} ${bar.scenes === 1 ? 'scene' : 'scenes'}`}
                  className={`w-full rounded-t-[2px] ${bar.scenes > 0 ? 'bg-ink2' : 'bg-line'}`}
                  style={{ height: `${String(bar.scenes > 0 ? Math.max(8, Math.round((bar.scenes / max) * 100)) : 2)}%` }}
                />
                <span className="text-9 text-ink3">E{bar.ordinal}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-[6px]">
          <div className="flex justify-between text-10 text-ink3">
            <span>Voice share</span>
            <span className="tabular">{voicePct === null ? ABSENT : `${String(voicePct)}%`}</span>
          </div>
          <div className="h-[6px] overflow-hidden rounded-[2px] bg-line2">
            <div className="h-full bg-accent" style={{ width: `${String(voicePct ?? 0)}%` }} />
          </div>
          <span className="text-10-5 text-ink3">
            {voicePct === null
              ? 'No dialogue in the script yet.'
              : `${String(voicePct)}% of the dialogue across ${String(profile.perEpisode.length)} ${
                  profile.perEpisode.length === 1 ? 'episode' : 'episodes'
                }.`}
          </span>
        </div>

        <div className="flex flex-col gap-[5px]">
          <span className="text-10 text-ink3">Where they are most</span>
          {profile.places.length === 0 ? (
            <span className="text-11 text-ink3">{ABSENT}</span>
          ) : (
            profile.places.map((place) => (
              <div key={place.locationId} className="flex items-center gap-[8px] text-11-5" data-place>
                <span aria-hidden="true" className="text-ink3" style={{ fontFamily: 'var(--font-glyph)' }}>
                  ⌖
                </span>
                <Link href={links.locations} className="flex-1 truncate text-ink no-underline hover:underline">
                  {place.name}
                </Link>
                <span className="tabular text-10-5 text-ink3">{place.scenes} sc</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-b border-line2 px-[14px] pb-[10px] pt-[12px] text-9-5 font-semibold uppercase tracking-label text-ink3">
        Elsewhere
      </div>
      <div className="flex flex-col gap-[8px] px-[14px] py-[12px] text-11-5">
        <ElsewhereRow href={links.bible} label="Bible" meta={ABSENT} tone="line" />
        <ElsewhereRow href={links.timeline} label="Timeline" meta={ABSENT} tone="line" />
        <ElsewhereRow href={links.insights} label="Insights · Presence" meta={gapNote} tone={profile.gap === null ? 'add' : 'note'} />
        {links.production === null ? null : (
          <ElsewhereRow href={links.production} label="Production · cast" meta="not yet" tone="line" />
        )}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-[6px] border-t border-line2 px-[14px] py-[10px]">
        {merging ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              merge()
            }}
            className="flex flex-col gap-[6px]"
          >
            <select
              autoFocus
              value={winner}
              onChange={(event) => {
                setWinner(event.target.value)
              }}
              aria-label="Merge into"
              data-merge-into
              className="rounded-chrome border border-line2 bg-sheet px-[8px] py-[4px] text-11-5 text-ink outline-none"
            >
              <option value="">Merge into…</option>
              {cast
                .filter((row) => row.id !== profile.id)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
            <span className="text-10 text-ink3">
              {profile.name}’s cues, relationships and arc move across; this record is kept as a pointer.
            </span>
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
          <div className="flex flex-col gap-[6px]">
            <span className="text-10-5 text-ink2">Delete {profile.name}’s record? The profile, arc and aliases go with it.</span>
            <span className="flex gap-[6px]">
              <button
                type="button"
                onClick={remove}
                data-confirm-delete
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
                Keep
              </button>
            </span>
          </div>
        ) : (
          <div className="flex gap-[6px]">
            <button
              type="button"
              onClick={() => {
                setMerging(true)
                setWinner('')
              }}
              disabled={cast.length < 2}
              data-merge-button
              className="flex-1 rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink disabled:opacity-50"
            >
              Merge into…
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(true)
              }}
              disabled={profile.presence === 'present'}
              title={
                profile.presence === 'present'
                  ? 'Still in the script. Remove the cues first, or merge the record.'
                  : 'Delete this record'
              }
              data-delete-button
              className="flex-none rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink3 hover:bg-del-bg hover:text-del disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

const ElsewhereRow = ({
  href,
  label,
  meta,
  tone,
}: {
  readonly href: ProjectRoutePath | NonNullable<ElsewhereLinks['production']>
  readonly label: string
  readonly meta: string
  readonly tone: 'add' | 'note' | 'line'
}) => (
  <div className="flex items-center gap-[8px]">
    <span className={`h-[6px] w-[6px] rounded-full ${tone === 'add' ? 'bg-add' : tone === 'note' ? 'bg-note' : 'bg-line'}`} />
    <Link href={href} className="flex-1 truncate">
      {label}
    </Link>
    <span className="text-10-5 text-ink3">{meta}</span>
  </div>
)
