import type { ProjectCard as Card } from '@folio/contracts'
import { episodeSlug, projectId, userId } from '@folio/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectCard, ProjectMeta } from '../app/(app)/app/(home)/_projects/project-card'
import { workspaceHref } from '../lib/projects/workspace'

/**
 * The card renders what it is handed and applies the empty-meta convention.
 *
 * AGENTS.md, UI fidelity: "things that legitimately count to zero show `0`;
 * things that either exist or don't show `—`; the script says `empty`." Each
 * of the three is one fixture below, and the fourth is the fully populated
 * series. Nothing here is computed by the component, so the fixtures carry
 * exactly the numbers the assertions read back.
 */

const NOW = new Date('2026-09-11T12:00:00.000Z')

const card = ({
  project,
  ...overrides
}: Partial<Omit<Card, 'project'>> & { readonly project?: Partial<Card['project']> }): Card => ({
  project: {
    id: projectId('00000000-0000-4000-8000-000000000001'),
    title: 'Monsoon Line',
    kind: 'screenwriting',
    projectType: 'series',
    format: 'hollywood',
    pageMode: 'paged',
    liveRepaginate: false,
    tags: [],
    createdBy: userId('00000000-0000-4000-8000-0000000000aa'),
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-11T11:29:00.000Z',
    trashedAt: null,
    ...project,
  },
  episodes: 6,
  script: 'present',
  scenes: 34,
  pages: 104,
  lastEditedAt: '2026-09-11T11:29:00.000Z',
  openingEpisode: episodeSlug('ep_001'),
  ...overrides,
})

// A `<dl>` has no ARIA list role, so it is reached as an element.
const metaText = (container: HTMLElement): string =>
  (container.querySelector('dl')?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('ProjectMeta', () => {
  it('shows episodes, scenes and pages for a measured series', () => {
    const { container } = render(<ProjectMeta card={card({})} />)
    expect(metaText(container)).toBe('Episodes 6 · Scenes 34 · Pages 104')
  })

  it('hides the episode count on a film, whose one row is a schema shape not a fact about the film', () => {
    const { container } = render(
      <ProjectMeta card={card({ project: { projectType: 'film' }, episodes: 1 })} />,
    )
    expect(metaText(container)).toBe('Scenes 34 · Pages 104')
  })

  it('shows — for pages when a script exists but has never been measured', () => {
    const { container } = render(<ProjectMeta card={card({ pages: null, scenes: 0 })} />)
    expect(metaText(container)).toBe('Episodes 6 · Scenes 0 · Pages —')
  })

  it('says the script is empty, in place of a page count, when there is no script', () => {
    const { container } = render(
      <ProjectMeta card={card({ script: 'absent', scenes: 0, pages: null, episodes: 1 })} />,
    )
    expect(metaText(container)).toBe('Episodes 1 · Script empty · Scenes 0')
    expect(screen.getByTitle('No script yet. The project opens on a blank sheet.')).toBeTruthy()
  })
})

describe('ProjectCard', () => {
  it('links a series to its first episode and a film to the collapsed path', () => {
    const series = card({})
    expect(workspaceHref(series.project, series.openingEpisode)).toBe(
      '/app/project/00000000-0000-4000-8000-000000000001/ep_001/script',
    )
    const film = card({ project: { projectType: 'film' } })
    expect(workspaceHref(film.project, film.openingEpisode)).toBe(
      '/app/project/00000000-0000-4000-8000-000000000001/script',
    )
  })

  it('sends a filmmaking project back to its list, because its workspace is an open decision', () => {
    const filmmaking = card({ project: { kind: 'filmmaking' } })
    expect(workspaceHref(filmmaking.project, filmmaking.openingEpisode)).toBe('/app/filmmaking')
  })

  it('renders the kind line, the title and the edit time from the model alone', () => {
    render(<ProjectCard card={card({})} now={NOW} />)
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/app/project/00000000-0000-4000-8000-000000000001/ep_001/script',
    )
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Monsoon Line')
    expect(screen.getByText('Screenwriting · Series · US Letter')).toBeTruthy()
    expect(screen.getByText('31 minutes ago').getAttribute('datetime')).toBe(
      '2026-09-11T11:29:00.000Z',
    )
  })
})
