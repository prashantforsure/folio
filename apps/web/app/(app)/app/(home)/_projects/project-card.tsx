import type { ProjectCard as ProjectCardModel } from '@folio/contracts'
import { Glyph } from '@folio/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { relativeTime } from '../../../../../lib/format/relative-time'
import {
  FORMAT_SHEET,
  KIND_GLYPH,
  KIND_LABEL,
  PROJECT_TYPE_LABEL,
} from '../../../../../lib/projects/labels'
import { workspaceHref } from '../../../../../lib/projects/workspace'

/**
 * The project card. One component for Recents, Screenwriting and Filmmaking;
 * its two inner pieces are shared with the Trash row.
 *
 * ## Every value on it is read, none is computed
 *
 * The card renders `ProjectCard` from `@folio/contracts` and nothing else. It
 * does not count, sum, or infer: `episodes` is a count of the `episodes` table,
 * `scenes` of the derived cache, `pages` of the measurement record, `script`
 * of the `documents` table, and `lastEditedAt` the later of two timestamps -
 * all assembled by `listProjectsFor` in `@folio/db`, whose header lists each
 * source. The design README: "real derived metadata ... never a placeholder
 * string", and the surest way to keep that true is for the component to have
 * nothing to compute with.
 *
 * The one thing done here is turning a timestamp into "31 minutes ago", with
 * the absolute time kept on the `<time>` element.
 *
 * ## The empty-meta convention, applied to three slots
 *
 * AGENTS.md, UI fidelity: "things that legitimately count to zero show `0`;
 * things that either exist or don't show `—`; the script says `empty`."
 *
 *   Scenes   counts to zero              `Scenes 0`
 *   Pages    a measurement exists or not `Pages —`
 *   Script   the script itself           `Script empty`, in place of Pages
 *
 * A project with no script is the designed state a new project is in, and it
 * is not rendered as zero pages: the Pages slot becomes `Script empty`, which
 * is the convention's own word and the explicit statement the README asks for.
 *
 * `Episodes` is shown for a series only. A film has exactly one episode row by
 * construction (AGENTS.md, Routing), and printing `Episodes 1` on every film
 * card would surface the schema's shape rather than the project's.
 *
 * ## Chrome
 *
 * Built from the tokens, patterned on the six shell-route observations in
 * `docs/ui design/` (`Route - Recents.dc.html` and siblings): a 12px-padded
 * `--panel` card with a `--line` border, a Courier 9.5px uppercase kind line,
 * the title in Newsreader 15px/500, a Courier 10px meta line, and a footer
 * rule with the edit time. Those observations carry a logline and a "Draft 5"
 * stage; neither exists in the schema, so neither is drawn.
 *
 * Colocated here, not in `packages/ui`, although three routes use it: it knows
 * what a project is, and that package "has no domain knowledge" (AGENTS.md,
 * Architecture). The three routes are one list implementation with a filter,
 * and this is that implementation's component.
 */

/** `✎ SCREENWRITING · FILM · US LETTER`. */
export const ProjectKindLine = ({ card }: { readonly card: ProjectCardModel }) => {
  const { project } = card
  return (
    <div className="flex items-start gap-[7px]">
      <Glyph name={KIND_GLYPH[project.kind]} className="mt-[2px] text-ink3" style={{ fontSize: 11 }} />
      <span className="min-w-0 flex-1 font-mono text-9-5 uppercase leading-[1.5] tracking-[.06em] text-ink3">
        {KIND_LABEL[project.kind]} · {PROJECT_TYPE_LABEL[project.projectType]} ·{' '}
        {FORMAT_SHEET[project.format]}
      </span>
    </div>
  )
}

const Meta = ({
  label,
  value,
  title,
}: {
  readonly label: string
  readonly value: string
  readonly title?: string | undefined
}) => (
  // The bare spaces are for the clipboard and for text extraction: a flex
  // container collapses whitespace-only text nodes, so they draw nothing, but
  // "Scenes 34" copies as two words rather than one.
  <div className="flex items-baseline gap-[4px]" title={title}>
    <dt className="text-ink3">{label}</dt>{' '}
    <dd className="tabular m-0 text-ink2">{value}</dd>
  </div>
)

const Dot = () => (
  <span aria-hidden="true" className="text-ink3">
    {' · '}
  </span>
)

/** `Episodes 6 · Scenes 34 · Pages 104`, with the convention applied. */
export const ProjectMeta = ({ card }: { readonly card: ProjectCardModel }) => (
  <dl className="m-0 flex flex-wrap items-baseline gap-x-[7px] gap-y-[2px] font-mono text-10">
    {card.project.projectType === 'series' ? (
      <>
        <Meta label="Episodes" value={String(card.episodes)} />
        <Dot />
      </>
    ) : null}
    {card.script === 'absent' ? (
      <>
        <Meta label="Script" value="empty" title="No script yet. The project opens on a blank sheet." />
        <Dot />
        <Meta label="Scenes" value={String(card.scenes)} />
      </>
    ) : (
      <>
        <Meta label="Scenes" value={String(card.scenes)} />
        <Dot />
        <Meta
          label="Pages"
          value={card.pages === null ? '—' : String(card.pages)}
          title={card.pages === null ? 'Not paginated yet.' : undefined}
        />
      </>
    )}
  </dl>
)

export const ProjectCard = ({ card, now }: { readonly card: ProjectCardModel; readonly now: Date }) => {
  const { project } = card
  return (
    <Link
      href={workspaceHref(project, card.openingEpisode)}
      className="flex min-h-[196px] flex-col gap-[7px] rounded-chrome border border-line bg-panel p-[12px] text-ink no-underline hover:border-accent-line hover:text-ink hover:no-underline"
    >
      <ProjectKindLine card={card} />
      <h2 className="m-0 font-serif text-15 font-medium leading-[1.25] tracking-title">
        {project.title}
      </h2>
      <div className="flex-1" />
      <ProjectMeta card={card} />
      <EditedFooter iso={card.lastEditedAt} now={now} />
    </Link>
  )
}

/** The footer rule and the edit time. Exported for the Trash row, which swaps the verb. */
export const EditedFooter = ({
  iso,
  now,
  verb = 'Edited',
  children,
}: {
  readonly iso: string
  readonly now: Date
  readonly verb?: string
  readonly children?: ReactNode
}) => (
  <div className="flex items-center gap-[8px] border-t border-line2 pt-[7px] text-10-5 text-ink3">
    <span className="flex-1">
      {verb}{' '}
      <time dateTime={iso} title={new Date(iso).toISOString()}>
        {relativeTime(iso, now)}
      </time>
    </span>
    {children}
  </div>
)
