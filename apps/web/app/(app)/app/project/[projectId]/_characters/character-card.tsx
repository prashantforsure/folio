'use client'

import type { ProjectId, ResolveItem, SceneFacts } from '@folio/contracts'
import { CHARACTER_STATUS_LABELS, PORTRAIT_TYPES } from '@folio/contracts'
import { EpisodeBars, PresenceStrip } from '@folio/ui'
import Link from 'next/link'
import { useState } from 'react'

import { resolveCue, uploadPortrait } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import { cueLine, fitsStrip, statusTone, stripGroups } from '../../../../../../lib/characters/cast'
import { citeOf } from '../../../../../../lib/characters/figures'
import { count } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import { ConflictBlock } from '../_chrome/conflict-block'
import type { Run } from '../_chrome/use-run'
import type { QueueDecision } from './unmatched-queue'

/**
 * One character, content first (the rebuild, 2026-09-18): the name over
 * the role with a 6px status dot and, with a portrait, a 28px thumbnail;
 * the alias line (`MEERA 79 · MEERA (V.O.) 3 · YOUNG MEERA 2`, three chips
 * and `+ N more`); the quote slot - the description, else the first line
 * the character speaks in quotes with its scene, else the introducing
 * action line under a `from the script` eyebrow, else `No description
 * yet.`; a conflict block when an open cue proposes this record; the
 * presence strip (or episode bars past `STRIP_LIMIT.card` scenes); and the
 * foot: `52 speaks · 27 mentioned · 412 lines` with the span as linked
 * chips. About 170px tall. The 4:5 face went with the mockup.
 *
 * The whole card is one link (`.folio-record-link`, stretched), so a
 * middle-click, a ctrl-click and Space are the browser's; the conflict
 * block's buttons and the chips sit above it (`data-raised`) and act on
 * their own. A dropped image on the card uploads as the portrait when
 * storage is configured (`data-over` draws the dashed outline).
 */
const CUES_SHOWN = 3

export const CharacterCard = ({
  projectId,
  shape,
  figure,
  index,
  selected,
  storage,
  run,
  onDecided,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly figure: CastFigure
  readonly index: readonly SceneFacts[]
  readonly selected: boolean
  readonly storage: boolean
  readonly run: Run
  /** A conflict block's decision, for the status bar's toast and its undo. */
  readonly onDecided: (item: ResolveItem, decision: QueueDecision) => void
}) => {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const href = characterHref(projectId, figure.id)
  const conflict = figure.conflicts[0]
  const cues = cueLine(figure.cues)
  const shownCues = cues.slice(0, CUES_SHOWN)
  const first = figure.first === null ? null : citeOf(projectId, shape, figure.first)
  const last = figure.last === null ? null : citeOf(projectId, shape, figure.last)

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
      if (result.status !== 'resolved') return result.message
      onDecided(
        item,
        choice.kind === 'proposal' ? { kind: 'bound', id: figure.id, name: figure.name } : { kind: 'not-this', id: figure.id, name: figure.name },
      )
      return null
    })
  }

  const quote =
    figure.bio !== null ? (
      <p className="m-0 line-clamp-2 text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }} data-card-line data-card-quote-kind="bio">
        {figure.bio}
      </p>
    ) : figure.quote !== null ? (
      <p className="m-0 line-clamp-2 text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }} data-card-line data-card-quote-kind="line">
        “{figure.quote.text}”
      </p>
    ) : figure.intro !== null ? (
      <div className="flex flex-col gap-[3px]" data-card-line data-card-quote-kind="intro">
        <span className="folio-eyebrow">from the script</span>
        <p className="m-0 line-clamp-2 text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
          {figure.intro.text}
        </p>
      </div>
    ) : (
      <p className="m-0 text-12-5 leading-[1.5] text-ink3" data-card-line data-card-quote-kind="none">
        No description yet.
      </p>
    )

  return (
    <article
      data-character-card={figure.id}
      data-status={figure.status}
      data-group={figure.group}
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
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
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
      <div className="flex items-center gap-[10px]">
        {figure.portraitUrl === null ? null : (
          <span className="relative h-[28px] w-[28px] flex-none overflow-hidden rounded-[7px] bg-sunk" data-card-portrait>
            <img src={figure.portraitUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </span>
        )}
        <span
          className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full"
          data-tone={statusTone(figure.status)}
          data-card-status={figure.status}
          title={CHARACTER_STATUS_LABELS[figure.status]}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <Link href={href} className="folio-record-link truncate text-14-5 font-medium tracking-title" data-card-link data-card-name>
            {figure.name}
          </Link>
          <span className="truncate text-11 text-ink3">{figure.role ?? 'No role yet'}</span>
        </span>
      </div>

      {cues.length === 0 ? (
        figure.presence === 'absent' ? (
          <span className="text-11 text-ink3" data-card-cues="none">
            Not on the page yet
          </span>
        ) : null
      ) : (
        <span className="flex flex-wrap items-center gap-[4px]" data-card-cues={cues.length} title={cues.join(' · ')}>
          {shownCues.map((cue) => (
            <span key={cue} className="folio-cite">
              {cue}
            </span>
          ))}
          {cues.length > CUES_SHOWN ? <span className="tabular text-10-5 text-ink3">+ {cues.length - CUES_SHOWN} more</span> : null}
        </span>
      )}

      {quote}

      {conflict === undefined ? null : (
        <div data-raised>
          <ConflictBlock
            title={`${conflict.cue} in the script reads like ${figure.name}.`}
            detail={`${String(conflict.occurrences)} ${conflict.occurrences === 1 ? 'cue' : 'cues'} under that spelling point at no record. Binding it makes them ${figure.name}'s; the script is not changed.`}
            accept={`It's ${figure.name}`}
            busy={busy}
            onAccept={() => {
              decide(conflict, { kind: 'proposal' })
            }}
            onDeliberate={() => {
              decide(conflict, { kind: 'not-this', id: figure.id })
            }}
          >
            <CitationChips refs={conflict.scenes.map((ref) => citeOf(projectId, shape, ref))} className="mt-[4px]" />
            {figure.conflicts.length > 1 ? (
              <span className="tabular mt-[4px] text-11 text-ink3" data-conflicts-more={figure.conflicts.length - 1}>
                + {figure.conflicts.length - 1} more in the queue
              </span>
            ) : null}
          </ConflictBlock>
        </div>
      )}

      {figure.presence === 'present' ? (
        fitsStrip('card', index.length) ? (
          <PresenceStrip groups={stripGroups(figure.strip, index)} size="card" />
        ) : (
          <EpisodeBars counts={figure.perEpisode} />
        )
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-[8px] gap-y-[4px]" data-raised>
        <span className="tabular min-w-0 flex-1 font-mono text-10-5 text-ink3" data-card-scenes={figure.appearances}>
          {count(figure.speaks)} speaks · {count(figure.mentionedIn)} mentioned · {count(figure.lines)} {figure.lines === 1 ? 'line' : 'lines'}
        </span>
        {first === null || last === null ? null : (
          <span className="flex items-center gap-[4px]" data-card-span>
            <Link href={first.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
              {first.label}
            </Link>
            <span className="text-10-5 text-ink3">→</span>
            <Link href={last.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
              {last.label}
            </Link>
          </span>
        )}
      </div>
    </article>
  )
}
