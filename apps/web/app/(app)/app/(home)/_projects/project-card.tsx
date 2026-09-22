'use client'

import type { ProjectCard as Card } from '@folio/contracts'
import Link from 'next/link'

import { relativeTime } from '../../../../../lib/format/relative-time'
import { workspaceHref } from '../../../../../lib/projects/workspace'
import {
  STAGE_LABEL,
  STAGE_TONE,
  isArchived,
  isShared,
  kindLine,
  stageOf,
  statsLine,
} from '../../../../../lib/projects/view'
import type { CardAction } from './card-menu'
import { CardMenu } from './card-menu'
import { ProjectPreview } from './project-preview'

/**
 * One project on the grid: the tile, the kind, a status chip when there is
 * something to say, the title, the logline, the stats and the edit time.
 *
 * **Every value on it is read; none is computed here.** `episodes` is a count
 * of the `episodes` table, `scenes` of the derived cache, `pages` of the
 * measurement record, `preview` of the node list, `members` of `memberships`,
 * and `generating` of `generations`. The one thing done in this file is
 * turning a timestamp into "31 minutes ago", with the absolute time kept on
 * the `<time>` element. AGENTS.md, UI fidelity: project cards show "real
 * derived metadata ... never a placeholder string".
 *
 * ## The status chip is live or it is absent
 *
 * The handoff's cards carry `Rendering 4/12`, `In production`, `6 new notes`.
 * The only one of those this product can answer is the first: a generation is
 * a row with a state, and while one is queued or running the chip says so and
 * its dot pulses. Archived says `Archived`. Everything else draws no chip,
 * because a chip that is always there says nothing.
 *
 * ## Why the whole card is not a `<a>`
 *
 * It carries a menu button and a checkbox, and a link cannot contain either.
 * So the card is a container with one stretched link over it
 * (`.folio-project-open`), and the controls sit above it on the z-axis - the
 * pattern the Storyboard's cards use. The link is what a keyboard reaches and
 * what a middle click opens; the stretched span is what a mouse hits. It
 * carries an `aria-label` and no text: a second copy of the title in the DOM
 * is a second thing a search, a screen reader's list and a test all have to
 * disambiguate.
 */
export const ProjectCard = ({
  card,
  now,
  selected,
  menuOpen,
  onMenu,
  onAct,
}: {
  readonly card: Card
  readonly now: Date
  readonly selected: boolean
  readonly menuOpen: boolean
  readonly onMenu: () => void
  readonly onAct: (action: CardAction) => void
}) => {
  const { project } = card
  const stage = stageOf(card)
  const chip = stage === 'generating' || stage === 'archived' ? STAGE_LABEL[stage] : null
  const tone = STAGE_TONE[stage]

  return (
    <div className="folio-project-card" data-selected={selected} data-project-card={project.id}>
      <Link
        href={workspaceHref(project, card.openingEpisode)}
        aria-label={`Open ${project.title}`}
        className="folio-project-open"
      />

      <button
        type="button"
        onClick={onMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`${project.title} actions`}
        className="folio-ghost-button absolute right-[10px] top-[10px] z-[4] grid h-[22px] w-[22px] place-items-center rounded-[7px] bg-s2 text-12 text-ink2"
      >
        ⋯
      </button>
      {menuOpen ? (
        <div className="absolute right-[10px] top-[4px] z-[25]">
          <CardMenu card={card} onAct={onAct} onClose={onMenu} />
        </div>
      ) : null}

      <ProjectPreview card={card} />

      <div className="relative z-[2] flex flex-1 flex-col gap-[7px] px-[15px] pb-[12px] pt-[13px]">
        <div className="pointer-events-none flex items-center gap-[8px]">
          <span className="folio-eyebrow min-w-0 flex-1 truncate text-10-5">{kindLine(card)}</span>
          {chip === null ? null : (
            <span
              className="folio-tone-pill flex items-center gap-[5px]"
              data-tone={tone === 'warn' ? 'warn' : 'none'}
              data-muted={tone === 'none' ? 'true' : undefined}
            >
              <span
                className="h-[5px] w-[5px] rounded-full bg-current"
                style={stage === 'generating' ? { animation: 'folio-pulsedot 1.8s ease-in-out infinite' } : undefined}
              />
              {chip}
              {stage === 'generating' && card.generating > 1 ? (
                <span className="tabular">{card.generating}</span>
              ) : null}
            </span>
          )}
        </div>

        <span className="pointer-events-none text-15 font-medium leading-[1.3] tracking-title">
          {project.title}
        </span>
        {project.logline === null ? null : (
          <p className="folio-clamp-3 pointer-events-none m-0 text-12-5 leading-[1.55] text-ink2">
            {project.logline}
          </p>
        )}

        <span className="flex-1" />
        <span className="tabular pointer-events-none font-mono text-10-5 text-ink3">{statsLine(card)}</span>
        <div className="pointer-events-none flex items-center gap-[8px] border-t border-line2 pt-[10px]">
          <span className="flex-1 text-11-5 text-ink3">
            Edited{' '}
            <time dateTime={card.lastEditedAt} title={new Date(card.lastEditedAt).toISOString()}>
              {relativeTime(card.lastEditedAt, now)}
            </time>
          </span>
          {isArchived(card) ? null : <Team card={card} />}
        </div>
      </div>
    </div>
  )
}

/**
 * The people on the project: nothing for one member, a `Shared` mark and the
 * initials for more. Read from `memberships` - a project with two rows in it
 * is shared, whoever created it.
 */
export const Team = ({ card, me }: { readonly card: Card; readonly me?: string }) => {
  if (card.members.length <= 1) return null
  const mine = me === undefined ? false : isShared(card, me)
  return (
    <span className="flex items-center gap-[6px] text-11 text-ink3">
      {mine ? 'Shared with you' : 'Shared'}
      <span className="flex">
        {card.members.slice(0, 3).map((member, index) => (
          <span
            key={member.id}
            title={member.displayName}
            className="grid h-[20px] w-[20px] place-items-center rounded-full border-[1.5px] border-bg bg-s3 text-8-5 text-ink2"
            style={index === 0 ? undefined : { marginLeft: -6 }}
          >
            {initialsOf(member.displayName)}
          </span>
        ))}
      </span>
    </span>
  )
}

/** Two letters from a name. The same reading `lib/auth/identity.ts` makes of the signed-in one. */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/u).filter((word) => word.length > 0)
  const first = words[0]
  if (first === undefined) return '?'
  const head = [...first][0] ?? '?'
  const second = words[1]
  if (second === undefined) return head.toUpperCase()
  return (head + ([...second][0] ?? '')).toUpperCase()
}
