import type { ProjectCard, ProjectKind } from '@folio/contracts'

import { ABSENT } from '../workspace/format'
import { FORMAT_SHEET, KIND_LABEL, PROJECT_TYPE_LABEL } from './labels'

/**
 * Everything the Projects route computes over its one query: the filters and
 * their counts, the sort, the stage, and the two lines of metadata a card and
 * a row print.
 *
 * Pure, and tested (`tests/projects-view.test.ts`). The route reads one list -
 * every live project, archived ones included - and this file turns it into
 * what each chip, column and card shows. Nothing here reaches a database and
 * nothing here invents a value: every function takes the `ProjectCard` read
 * model and returns a view of it.
 *
 * ## Why the filters are client-side
 *
 * AGENTS.md, Routing: "Sub-views are query params, never separate routes",
 * and adding a query param is behind "ask first". The chips are not sub-views
 * of a route - they are a filter over a list already in memory, the way the
 * Storyboard's and Scenes' views became client state (ruled 2026-09-17) - so
 * the URL stays `/app/projects` whichever chip is lit, and the counts beside
 * them are counts of the same array rather than five more queries.
 */

export const PROJECT_FILTERS = ['all', 'screenwriting', 'filmmaking', 'shared', 'archived'] as const

export type ProjectFilter = (typeof PROJECT_FILTERS)[number]

export const FILTER_LABEL: Readonly<Record<ProjectFilter, string>> = {
  all: 'All',
  screenwriting: 'Screenplays',
  filmmaking: 'Filmmaking',
  shared: 'Shared with me',
  archived: 'Archived',
}

export const PROJECT_SORTS = ['recent', 'title', 'stage', 'kind'] as const

export type ProjectSort = (typeof PROJECT_SORTS)[number]

export const SORT_LABEL: Readonly<Record<ProjectSort, string>> = {
  recent: 'Recently edited',
  title: 'Title',
  stage: 'Stage',
  kind: 'Kind',
}

export const PROJECT_LAYOUTS = ['grid', 'list'] as const

export type ProjectLayout = (typeof PROJECT_LAYOUTS)[number]

/** Archived is a state of the project, not a kind of it. `All` leaves it out. */
export const isArchived = (card: ProjectCard): boolean => card.project.archivedAt !== null

/** Shared with me: somebody else made it and I am a member. */
export const isShared = (card: ProjectCard, me: string): boolean => card.project.createdBy !== me

export const matchesFilter = (card: ProjectCard, filter: ProjectFilter, me: string): boolean => {
  if (filter === 'archived') return isArchived(card)
  if (isArchived(card)) return false
  if (filter === 'all') return true
  if (filter === 'shared') return isShared(card, me)
  return card.project.kind === (filter satisfies ProjectKind)
}

export const filterCounts = (
  cards: readonly ProjectCard[],
  me: string,
): Readonly<Record<ProjectFilter, number>> => ({
  all: cards.filter((card) => matchesFilter(card, 'all', me)).length,
  screenwriting: cards.filter((card) => matchesFilter(card, 'screenwriting', me)).length,
  filmmaking: cards.filter((card) => matchesFilter(card, 'filmmaking', me)).length,
  shared: cards.filter((card) => matchesFilter(card, 'shared', me)).length,
  archived: cards.filter((card) => matchesFilter(card, 'archived', me)).length,
})

/**
 * Where a project has got to. Read, never guessed.
 *
 * The handoff's cards carry a stage per project - `Draft 5`, `Prep`,
 * `Rendering` - and none of those exists in this schema: there is no draft
 * number on a project, no production status and no schedule. What a project
 * genuinely has is a state (archived or not) and a script (absent, unwritten
 * or written), and those are what this returns. The words are the ones the
 * rest of the product already uses: `empty` for a script that does not exist
 * (AGENTS.md, UI fidelity's empty-meta convention), `Generating` for the thing
 * the ledger is paying for right now.
 */
export type ProjectStage = 'generating' | 'archived' | 'no-script' | 'no-scenes' | 'written'

export const stageOf = (card: ProjectCard): ProjectStage => {
  if (card.generating > 0) return 'generating'
  if (isArchived(card)) return 'archived'
  if (card.script === 'absent') return 'no-script'
  if (card.scenes === 0) return 'no-scenes'
  return 'written'
}

export const STAGE_LABEL: Readonly<Record<ProjectStage, string>> = {
  generating: 'Generating',
  archived: 'Archived',
  'no-script': 'No script',
  'no-scenes': 'Started',
  written: 'Written',
}

/** The tone each stage draws in. `none` is the quiet default; `warn` is the live one. */
export const STAGE_TONE: Readonly<Record<ProjectStage, 'warn' | 'ok' | 'none'>> = {
  generating: 'warn',
  archived: 'none',
  'no-script': 'none',
  'no-scenes': 'none',
  written: 'ok',
}

/**
 * The card's mono stats line: `6 eps · 34 scenes · 104pp`.
 *
 * The empty-meta convention, applied three times (AGENTS.md, UI fidelity):
 * scenes count to zero and show `0`; a page count either exists or does not
 * and shows `—`; a project with no script says `script empty` in place of the
 * page count, because that is the designed state a new project is in and not
 * a measurement of zero. Episodes appear for a series only - a film has one
 * episode row by construction, and printing `1 ep` on every film card would
 * surface the schema rather than the film.
 */
export const statsLine = (card: ProjectCard): string => {
  const parts: string[] = []
  if (card.project.projectType === 'series') {
    parts.push(`${String(card.episodes)} ${card.episodes === 1 ? 'ep' : 'eps'}`)
  }
  if (card.script === 'absent') {
    parts.push('script empty')
    return parts.join(' · ')
  }
  parts.push(`${String(card.scenes)} ${card.scenes === 1 ? 'scene' : 'scenes'}`)
  parts.push(card.pages === null ? `pages ${ABSENT}` : `${String(card.pages)}pp`)
  return parts.join(' · ')
}

/** The uppercase kind line over the title: `Screenwriting · Series`. */
export const kindLine = (card: ProjectCard): string =>
  `${KIND_LABEL[card.project.kind]} · ${PROJECT_TYPE_LABEL[card.project.projectType]}`

/** The list view's Length column: pages, or the reason there are none. */
export const lengthOf = (card: ProjectCard): string => {
  if (card.script === 'absent') return 'empty'
  return card.pages === null ? ABSENT : `${String(card.pages)}pp`
}

/** The sheet the project is measured on, for the dialog's footer and the row. */
export const sheetOf = (card: ProjectCard): string => FORMAT_SHEET[card.project.format]

/**
 * Sort, newest edit first by default.
 *
 * `recent` is the order the repository already returns (`ORDER BY` the later
 * of the project row and its documents), so it is the identity - the array is
 * copied rather than re-sorted, which keeps the two agreeing about ties.
 * The other three are stable, comparing on one field and falling back to that
 * same order.
 */
export const sortCards = (cards: readonly ProjectCard[], sort: ProjectSort): readonly ProjectCard[] => {
  if (sort === 'recent') return [...cards]
  const ordered = cards.map((card, index) => ({ card, index }))
  const by = (card: ProjectCard): string => {
    if (sort === 'title') return card.project.title.toLocaleLowerCase()
    if (sort === 'kind') return kindLine(card).toLocaleLowerCase()
    return STAGE_LABEL[stageOf(card)].toLocaleLowerCase()
  }
  ordered.sort((left, right) => {
    const compared = by(left.card).localeCompare(by(right.card))
    return compared === 0 ? left.index - right.index : compared
  })
  return ordered.map((entry) => entry.card)
}

/** `3 projects · 2 screenplays, 1 filmmaking`. The list view's footer, all live counts. */
export const countLabel = (visible: readonly ProjectCard[]): string => {
  const screenplays = visible.filter((card) => card.project.kind === 'screenwriting').length
  const filmmaking = visible.length - screenplays
  const parts = [`${String(visible.length)} ${visible.length === 1 ? 'project' : 'projects'}`]
  if (screenplays > 0) parts.push(`${String(screenplays)} ${screenplays === 1 ? 'screenplay' : 'screenplays'}`)
  if (filmmaking > 0) parts.push(`${String(filmmaking)} filmmaking`)
  return parts.join(' · ')
}

/**
 * The list a filter chip and a sort show: the matching cards, sorted. The
 * Projects route draws it and `readProjectList` (`lib/projects/server.ts`)
 * answers the agent with it - one function, so "which projects are archived?"
 * is answered by the chip's own predicate (roadmap task 2.4).
 */
export const visibleCards = (cards: readonly ProjectCard[], filter: ProjectFilter, sort: ProjectSort, me: string): readonly ProjectCard[] =>
  sortCards(cards.filter((card) => matchesFilter(card, filter, me)), sort)
