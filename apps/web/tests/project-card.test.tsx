import type { ProjectCard as Card } from '@folio/contracts'
import { episodeSlug, projectId, userId } from '@folio/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectCard } from '../app/(app)/app/(home)/_projects/project-card'
import { ProjectPreview } from '../app/(app)/app/(home)/_projects/project-preview'
import { workspaceHref } from '../lib/projects/workspace'

/**
 * The card renders what it is handed, and the preview tile draws the script.
 *
 * Nothing in either component computes a value, so the fixtures carry exactly
 * the numbers and lines the assertions read back. The empty-meta convention
 * itself is `lib/projects/view.ts`'s and is tested there
 * (`projects-view.test.ts`); what is tested here is that the card prints it.
 */

const NOW = new Date('2026-09-11T12:00:00.000Z')

export const card = ({
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
    logline: null,
    createdBy: userId('00000000-0000-4000-8000-0000000000aa'),
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-11T11:29:00.000Z',
    trashedAt: null,
    archivedAt: null,
    ...project,
  },
  episodes: 6,
  script: 'present',
  scenes: 34,
  pages: 104,
  lastEditedAt: '2026-09-11T11:29:00.000Z',
  openingEpisode: episodeSlug('ep_001'),
  members: [],
  generating: 0,
  preview: [],
  ...overrides,
})

const noop = (): void => undefined

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

  it('sends a filmmaking project to the list, because its workspace is an open decision', () => {
    const filmmaking = card({ project: { kind: 'filmmaking' } })
    expect(workspaceHref(filmmaking.project, filmmaking.openingEpisode)).toBe('/app/projects')
  })

  it('renders the kind line, the stats and the edit time from the model alone', () => {
    render(
      <ProjectCard card={card({})} now={NOW} selected={false} menuOpen={false} onMenu={noop} onAct={noop} />,
    )
    const open = screen.getByRole('link', { name: 'Open Monsoon Line' })
    expect(open.getAttribute('href')).toBe(
      '/app/project/00000000-0000-4000-8000-000000000001/ep_001/script',
    )
    // The stretched link carries a label, not a second copy of the title.
    expect(screen.getAllByText('Monsoon Line')).toHaveLength(1)
    expect(screen.getByText('Screenwriting · Series')).toBeTruthy()
    expect(screen.getByText('6 eps · 34 scenes · 104pp')).toBeTruthy()
    expect(screen.getByText('31 minutes ago').getAttribute('datetime')).toBe(
      '2026-09-11T11:29:00.000Z',
    )
  })

  it('prints the logline when there is one and leaves the line out when there is not', () => {
    const { rerender, container } = render(
      <ProjectCard card={card({})} now={NOW} selected={false} menuOpen={false} onMenu={noop} onAct={noop} />,
    )
    expect(container.querySelector('p')).toBeNull()

    rerender(
      <ProjectCard
        card={card({ project: { logline: 'A stage magician’s assistant inherits the act.' } })}
        now={NOW}
        selected={false}
        menuOpen={false}
        onMenu={noop}
        onAct={noop}
      />,
    )
    expect(screen.getByText('A stage magician’s assistant inherits the act.')).toBeTruthy()
  })

  it('says a project is generating only while a generation is live', () => {
    const { rerender } = render(
      <ProjectCard card={card({})} now={NOW} selected={false} menuOpen={false} onMenu={noop} onAct={noop} />,
    )
    expect(screen.queryByText('Generating')).toBeNull()

    rerender(
      <ProjectCard
        card={card({ generating: 2 })}
        now={NOW}
        selected={false}
        menuOpen={false}
        onMenu={noop}
        onAct={noop}
      />,
    )
    expect(screen.getByText('Generating')).toBeTruthy()
  })
})

describe('ProjectPreview', () => {
  it('draws the script’s own opening lines, each as its element type', () => {
    const { container } = render(
      <ProjectPreview
        card={card({
          preview: [
            { type: 'scene', text: 'INT. BACKSTAGE — NIGHT' },
            { type: 'action', text: 'Velvet, sawdust, a rabbit that has seen too much.' },
            { type: 'character', text: 'MEERA' },
            { type: 'dialogue', text: 'You inherit the act. You inherit the ledger.' },
          ],
        })}
      />,
    )
    const lines = [...container.querySelectorAll('.folio-page-line')]
    expect(lines.map((line) => line.getAttribute('data-line'))).toEqual([
      'scene',
      'action',
      'character',
      'dialogue',
    ])
    expect(lines[0]?.textContent).toBe('INT. BACKSTAGE — NIGHT')
  })

  it('says a script is empty rather than drawing a blank page', () => {
    const { container } = render(<ProjectPreview card={card({ script: 'absent', preview: [] })} />)
    expect(container.textContent).toBe('empty')
  })

  it('draws a frame, not a page, for a filmmaking project', () => {
    const { container } = render(<ProjectPreview card={card({ project: { kind: 'filmmaking' } })} />)
    expect(container.querySelector('.folio-frame-preview')).not.toBeNull()
    expect(container.querySelector('.folio-page-preview')).toBeNull()
  })
})
