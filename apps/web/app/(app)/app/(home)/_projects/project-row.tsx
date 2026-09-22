'use client'

import type { ProjectCard as Card } from '@folio/contracts'
import Link from 'next/link'

import { relativeTime } from '../../../../../lib/format/relative-time'
import { workspaceHref } from '../../../../../lib/projects/workspace'
import { STAGE_LABEL, STAGE_TONE, kindLine, lengthOf, stageOf } from '../../../../../lib/projects/view'
import type { CardAction } from './card-menu'
import { CardMenu } from './card-menu'
import { initialsOf } from './project-card'

/**
 * One project as a row: checkbox, title and logline, kind, stage, length,
 * team, edited, and the same `⋯` menu the card carries.
 *
 * The columns are the handoff's, and each one is read:
 *
 *   Kind    `kind` and `project_type` - `Screenwriting · Series`
 *   Stage   where the project has got to, derived from what exists
 *           (`lib/projects/view.ts`, `stageOf`) - never a draft number, which
 *           this schema does not have
 *   Length  the measurement record's page count, `—` when nothing has been
 *           measured and `empty` when there is no script to measure
 *   Team    `memberships`, joined to `users` by the same query the card reads
 *   Edited  the later of the project row and its documents
 *
 * **Selection is the list view's alone.** The grid has no checkbox (the
 * client removed it with this handoff), so the bulk bar only ever appears
 * over rows. Shift-click extends from the last row touched, which is the one
 * thing a checkbox column owes a keyboard-less user.
 */
export const ProjectRow = ({
  card,
  now,
  selected,
  menuOpen,
  onMenu,
  onAct,
  onToggle,
}: {
  readonly card: Card
  readonly now: Date
  readonly selected: boolean
  readonly menuOpen: boolean
  readonly onMenu: () => void
  readonly onAct: (action: CardAction) => void
  readonly onToggle: (extend: boolean) => void
}) => {
  const { project } = card
  const stage = stageOf(card)

  return (
    <div className="folio-list-row" data-selected={selected} data-project-row={project.id}>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${project.title}`}
        onClick={(event) => {
          onToggle(event.shiftKey)
        }}
        className="folio-checkbox"
      >
        ✓
      </button>

      <span className="flex min-w-0 items-center gap-[11px]">
        <span
          aria-hidden="true"
          className="h-[32px] w-[24px] flex-none rounded-[4px] border border-line2"
          style={{
            background:
              project.kind === 'filmmaking'
                ? 'linear-gradient(160deg, var(--frame-a), var(--frame-b))'
                : 'var(--sunk)',
            ...(project.kind === 'filmmaking' ? { height: 24, width: 40 } : {}),
          }}
        />
        <span className="flex min-w-0 flex-col gap-[2px]">
          <Link
            href={workspaceHref(project, card.openingEpisode)}
            className="truncate text-13 text-ink hover:text-ink"
          >
            {project.title}
          </Link>
          <span className="truncate text-11-5 text-ink3">
            {project.logline ?? 'No logline yet'}
          </span>
        </span>
      </span>

      <span className="truncate text-12-5 text-ink2">{kindLine(card)}</span>
      <span className="folio-tone-ink text-12" data-tone={STAGE_TONE[stage]}>
        {STAGE_LABEL[stage]}
      </span>
      <span className="tabular font-mono text-12 text-ink2">{lengthOf(card)}</span>
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
      <span className="text-12 text-ink3">
        <time dateTime={card.lastEditedAt} title={new Date(card.lastEditedAt).toISOString()}>
          {relativeTime(card.lastEditedAt, now)}
        </time>
      </span>

      <span className="relative flex justify-center">
        <button
          type="button"
          onClick={onMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`${project.title} actions`}
          className="folio-ghost-button grid h-[24px] w-[24px] place-items-center rounded-[7px] text-12 text-ink3"
        >
          ⋯
        </button>
        {menuOpen ? <CardMenu card={card} onAct={onAct} onClose={onMenu} /> : null}
      </span>
    </div>
  )
}
