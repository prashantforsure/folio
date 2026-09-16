'use client'

import type { ProjectId, ResolveItem } from '@folio/contracts'
import { CHARACTER_STATUS_LABELS, PORTRAIT_TYPES } from '@folio/contracts'
import { EpisodeBars } from '@folio/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { resolveCue, uploadPortrait } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import { sceneLabel, statusTone } from '../../../../../../lib/characters/cast'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import { ConflictBlock } from '../_chrome/conflict-block'
import type { Run } from './characters-workspace'

/**
 * One character, as `Route - Characters v2.dc.html` draws the card: a
 * `--s1` card at a 14px radius, the 4:5 face on `--sunk` - the portrait
 * with a scrim and the name in white over its foot, or the dashed inset
 * with the 42px/200 initial, `Drop a reference` and the name on `--bg` -
 * the status badge top right; then the description (12.5px, three lines),
 * and the foot: `79 scenes` in mono beside the episode bars (`@folio/ui`'s
 * `EpisodeBars`, `E1 28 · E2 24 · E3 27` in its title).
 *
 * The card is a link to `/characters/:id`, the drawer. `aria-current`
 * while that record is the drawer's: the border is `--line`. A conflict -
 * an open cue proposing this record - turns the border `--warn` and draws
 * the README's amber block under the description with `It's <name>` /
 * `It's deliberate` (`_chrome/conflict-block.tsx`).
 *
 * `Drop a reference` is real: a file dropped on the face uploads as the
 * portrait, through `uploadPortrait`, with storage configured; without it
 * the hint is not drawn and nothing accepts a drop.
 */
export const CharacterCard = ({
  projectId,
  figure,
  selected,
  storage,
  run,
}: {
  readonly projectId: ProjectId
  readonly figure: CastFigure
  readonly selected: boolean
  readonly storage: boolean
  readonly run: Run
}) => {
  const router = useRouter()
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const href = characterHref(projectId, figure.id)
  const portrait = figure.portraitUrl
  const conflict = figure.conflicts[0]
  const tone = statusTone(figure.status)

  const upload = (file: File): void => {
    if (!PORTRAIT_TYPES.includes(file.type as (typeof PORTRAIT_TYPES)[number])) return
    run(async () => {
      const form = new FormData()
      form.set('portrait', file)
      const result = await uploadPortrait(projectId, figure.id, form)
      return result.status === 'saved' ? null : result.message
    })
  }

  const decide = (item: ResolveItem, choice: { readonly kind: 'proposal' } | { readonly kind: 'not-this'; readonly id: string }): void => {
    setBusy(true)
    run(async () => {
      const result = await resolveCue(projectId, item.key, choice)
      setBusy(false)
      return result.status === 'resolved' ? null : result.message
    })
  }

  return (
    <article
      data-character-card={figure.id}
      data-status={figure.status}
      data-group={figure.group}
      data-conflict={conflict === undefined ? 'false' : 'true'}
      aria-current={selected ? 'true' : undefined}
      className="folio-cast-card"
      onClick={() => {
        router.push(href)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') router.push(href)
      }}
      role="link"
      tabIndex={0}
      aria-label={`Edit ${figure.name}`}
    >
      <div
        data-card-face
        data-has-portrait={portrait === null ? 'false' : 'true'}
        className="relative flex flex-none items-center justify-center overflow-hidden bg-sunk"
        style={{ aspectRatio: '4 / 5' }}
        onDragOver={(event) => {
          if (!storage) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => {
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
        {portrait === null ? (
          <span
            aria-hidden="true"
            className="absolute inset-[10px] rounded-[9px] border border-dashed"
            style={{ borderColor: over ? 'var(--accent)' : 'var(--line)' }}
          />
        ) : (
          <img src={portrait} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {portrait === null ? (
          <span className="relative flex flex-col items-center gap-[7px] pb-[22px]">
            <span className="text-[42px] font-extralight leading-none tracking-[-.03em] text-ink3">{figure.initial}</span>
            {storage ? <span className="text-11 text-ink3">Drop a reference</span> : null}
          </span>
        ) : null}
        <span className="folio-cast-badge folio-tone-ink" data-tone={tone} data-card-status>
          {CHARACTER_STATUS_LABELS[figure.status]}
        </span>
        <span
          className="absolute inset-x-0 bottom-0 flex flex-col gap-[2px]"
          style={
            portrait === null
              ? { padding: '9px 12px 10px', background: 'var(--bg)' }
              : {
                  padding: '28px 12px 11px',
                  background: 'linear-gradient(to bottom, transparent, var(--cast-scrim-mid) 38%, var(--cast-scrim-end))',
                }
          }
        >
          <span
            className="truncate text-15 font-medium tracking-title"
            style={{ color: portrait === null ? 'var(--ink)' : 'var(--cast-face-name)' }}
            data-card-name
          >
            {figure.name}
          </span>
          <span className="truncate text-11" style={{ color: portrait === null ? 'var(--ink3)' : 'var(--cast-face-sub)' }}>
            {figure.role ?? 'No role yet'}
          </span>
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[11px] p-[12px]">
        <p
          className={`m-0 line-clamp-3 text-12-5 leading-[1.5] ${figure.bio === null ? 'text-ink3' : 'text-ink2'}`}
          style={{ textWrap: 'pretty' }}
          data-card-line
        >
          {figure.bio ?? 'No description yet.'}
        </p>
        {conflict === undefined ? null : (
          <ConflictBlock
            title={`${conflict.cue} in the script reads like ${figure.short}.`}
            detail={`${String(conflict.occurrences)} ${conflict.occurrences === 1 ? 'cue' : 'cues'} under that spelling point at no record. Binding it makes them ${figure.short}'s; the script is not changed.`}
            accept={`It's ${figure.short}`}
            busy={busy}
            onAccept={() => {
              decide(conflict, { kind: 'proposal' })
            }}
            onDeliberate={() => {
              decide(conflict, { kind: 'not-this', id: figure.id })
            }}
          >
            <CitationChips refs={conflict.scenes.map(formatSceneRef)} className="mt-[4px]" />
            {figure.conflicts.length > 1 ? (
              <span className="tabular mt-[4px] text-11 text-ink3" data-conflicts-more={figure.conflicts.length - 1}>
                + {figure.conflicts.length - 1} more in the queue
              </span>
            ) : null}
          </ConflictBlock>
        )}
        <div className="mt-auto flex items-center gap-[10px]">
          <span className={`tabular min-w-0 flex-1 font-mono text-10-5 text-ink3`} data-card-scenes>
            {sceneLabel(figure.appearances)}
          </span>
          <EpisodeBars counts={figure.perEpisode} />
        </div>
      </div>
    </article>
  )
}
