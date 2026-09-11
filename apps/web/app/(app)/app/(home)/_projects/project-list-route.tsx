import type { ProjectKind } from '@folio/contracts'
import { Glyph } from '@folio/ui'
import { countProjectsFor, listProjectsFor, transactionDatabase } from '@folio/db'
import Link from 'next/link'

import { requireUser } from '../../../../../lib/auth/session'
import { PageHeader } from '../../../_shell/page-header'
import { ProjectCard } from './project-card'

/**
 * Recents, Screenwriting and Filmmaking: **three views over one list.**
 *
 * One query (`listProjectsFor`, with a filter), one card (`ProjectCard`), one
 * empty state (`EmptyList`), and this file. The three `page.tsx` files are one
 * line each. The brief: "Do not build three route implementations."
 *
 * What differs per view is data - the filter, the title, the aside, and the
 * empty-state copy - so it is a record keyed by the view, not a branch in the
 * markup.
 *
 * ## The two states
 *
 * AGENTS.md, Development philosophy 4: "Both states always. Populated and empty
 * ship together." A new user's first screen after onboarding is the empty
 * project list, so the empty state is the common case, not an edge. It is
 * decided by the same query that populates the grid: zero rows is the empty
 * state, and nothing else is consulted.
 *
 * ## Why `/app/filmmaking` is a view of this file and not a route of its own
 *
 * AGENTS.md open decision 9 and Constraints: "`/app/filmmaking` is a project
 * list and a creation entry point. Stop there." This is that list. There is no
 * filmmaking rail, no `plots`, no `Task`, and nothing here that a screenwriting
 * project does not also get. The competitor's shape - Production · Characters
 * · Locations · Task, with no Writing section - appears nowhere in the data
 * model and is not built.
 *
 * ## Not built, on purpose
 *
 * No grid/list toggle and no sort control: each would be a sub-view, and
 * AGENTS.md makes a sub-view a query param, which is behind "ask first". The
 * order is fixed - most recently edited first - and it is the repository's
 * `ORDER BY`, not a component's sort.
 */

export type ListView = 'recents' | 'screenwriting' | 'filmmaking'

type ViewSpec = {
  readonly title: string
  readonly aside: string
  readonly kind: ProjectKind | 'all'
  readonly emptyTitle: string
  readonly emptyCopy: string
}

const VIEWS: Record<ListView, ViewSpec> = {
  recents: {
    title: 'Recents',
    aside: 'All projects, most recently edited first',
    kind: 'all',
    emptyTitle: 'Nothing here yet',
    emptyCopy:
      'Every project you belong to is listed here, most recently edited first. Start one and it appears at the top.',
  },
  screenwriting: {
    title: 'Screenwriting',
    aside: 'Screenplay projects only',
    kind: 'screenwriting',
    emptyTitle: 'No screenplays yet',
    emptyCopy:
      'A screenwriting project opens on a blank sheet in Courier 12pt. Scenes, characters and locations are derived from what you write, never kept separately.',
  },
  filmmaking: {
    title: 'Filmmaking',
    aside: 'Filmmaking projects only',
    kind: 'filmmaking',
    emptyTitle: 'No filmmaking projects yet',
    emptyCopy:
      'Filmmaking projects can be started and listed here. What a filmmaking workspace opens on — and whether a script sits behind every shot — is still being decided, so for now opening one brings you back to this list.',
  },
}

/** The dashed create card, at the head of the grid and in the empty state. */
const CreateCard = ({ minHeight }: { readonly minHeight: number }) => (
  <Link
    href="/app/new"
    className="flex flex-col items-center justify-center gap-[7px] rounded-chrome border border-dashed border-line p-[18px_13px] text-center text-ink no-underline hover:border-accent-line hover:text-ink hover:no-underline"
    style={{ minHeight }}
  >
    <Glyph name="create" className="text-ink2" style={{ fontSize: 16 }} />
    <span className="text-12-5 font-medium">New project</span>
    <span className="max-w-[158px] text-11 leading-[1.55] text-ink3">
      Screenwriting or filmmaking, film or series, US Letter or A4.
    </span>
  </Link>
)

const EmptyList = ({ view }: { readonly view: ViewSpec }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-[20px] px-[24px] py-[56px]">
    <div className="flex max-w-[400px] flex-col gap-[7px] text-center">
      <h2 className="m-0 font-serif text-21 font-normal tracking-title">{view.emptyTitle}</h2>
      <p className="m-0 text-12 leading-[1.6] text-ink2">{view.emptyCopy}</p>
    </div>
    <div className="w-full max-w-[260px]">
      <CreateCard minHeight={176} />
    </div>
  </div>
)

const TrashLink = ({ count }: { readonly count: number }) => (
  <Link
    href="/app/trash"
    className="rounded-chrome border border-line2 px-[9px] py-[3px] text-11 text-ink2 no-underline hover:bg-hover hover:text-ink hover:no-underline"
  >
    Trash <span className="tabular text-ink3">· {count}</span>
  </Link>
)

const NewLink = () => (
  <Link
    href="/app/new"
    className="rounded-chrome bg-accent px-[10px] py-[4px] text-11 font-medium text-accent-ink no-underline hover:text-accent-ink hover:no-underline"
  >
    New project
  </Link>
)

export const ProjectListRoute = async ({ view: name }: { readonly view: ListView }) => {
  const view = VIEWS[name]
  const user = await requireUser(`/app/${name}`)
  const db = await transactionDatabase()
  const [cards, trashed] = await Promise.all([
    listProjectsFor(db, user.id, { kind: view.kind, trashed: false }),
    countProjectsFor(db, user.id, { trashed: true }),
  ])
  const now = new Date()

  return (
    <>
      <PageHeader
        title={view.title}
        aside={view.aside}
        actions={
          <div className="flex items-center gap-[8px]">
            <TrashLink count={trashed} />
            <NewLink />
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {cards.length === 0 ? (
          <EmptyList view={view} />
        ) : (
          <div className="max-w-[1240px]">
            <p className="m-0 px-[18px] pt-[14px] text-11-5 text-ink2">
              <span className="tabular">{cards.length}</span>{' '}
              {cards.length === 1 ? 'project' : 'projects'}
            </p>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-[12px] px-[18px] pb-[26px] pt-[14px]">
              <li className="flex flex-col">
                <CreateCard minHeight={196} />
              </li>
              {cards.map((card) => (
                <li key={card.project.id} className="flex flex-col">
                  <ProjectCard card={card} now={now} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
