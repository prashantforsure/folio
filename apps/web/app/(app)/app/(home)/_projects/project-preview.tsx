import type { ProjectCard } from '@folio/contracts'
import { Icon } from '@folio/ui'

/**
 * The tile at the top of a project card: the first few lines of the script,
 * set like a script, or a 16:9 frame for a project that has no page to show.
 *
 * ## It is the script, not a picture of one
 *
 * `card.preview` is the opening episode's first blocks - the node type and
 * the text, with every `@mention` already resolved to its record's name by
 * the repository (`listProjectsFor`). So a scene heading is uppercase because
 * it *is* a scene heading, dialogue is indented because it is dialogue, and a
 * project whose script starts with three lines of action shows three lines of
 * action. There is no sample text anywhere in this file.
 *
 * The layout is proportional, not measured: 38% for a cue, 18% for dialogue,
 * the engine's own proportions rounded to what reads at 9px. The measured
 * article is the pagination engine's and it is not drawn at thumbnail size.
 *
 * ## Three states, because a project genuinely has three
 *
 *   a script      its own opening lines
 *   no script     the sheet, and the word the convention uses - `empty`
 *   filmmaking    the 16:9 frame: there is no script behind a filmmaking
 *                 project and no workspace to read one from (AGENTS.md open
 *                 decision 9), so the tile says what the project is rather
 *                 than pretending to a page.
 */
export const ProjectPreview = ({ card }: { readonly card: ProjectCard }) => {
  if (card.project.kind === 'filmmaking') {
    return (
      <div className="folio-frame-preview">
        <span className="grid h-[36px] w-[36px] place-items-center rounded-full border border-frame-ink/30 text-frame-ink">
          <Icon name="play" size={13} strokeWidth={1.4} />
        </span>
        <span className="tabular absolute bottom-[12px] left-[12px] font-mono text-10-5 tracking-[.04em] text-frame-ink/60">
          16:9
        </span>
      </div>
    )
  }

  if (card.preview.length === 0) {
    return (
      <div className="folio-page-preview grid place-items-center">
        <span className="font-mono text-10-5 text-ink3">empty</span>
      </div>
    )
  }

  return (
    <div className="folio-page-preview" aria-hidden="true">
      {card.preview.map((line, index) => (
        <span key={`${String(index)}-${line.text}`} className="folio-page-line" data-line={line.type}>
          {line.text}
        </span>
      ))}
    </div>
  )
}
