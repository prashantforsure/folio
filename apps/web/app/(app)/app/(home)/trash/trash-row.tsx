'use client'

import type { ProjectCard } from '@folio/contracts'
import { Glyph } from '@folio/ui'
import { useActionState, useId, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import { purgeProject, restoreProject } from '../../../../../lib/projects/actions'
import { KIND_GLYPH } from '../../../../../lib/projects/labels'
import { IDLE } from '../../../../../lib/projects/result'
import { EditedFooter, ProjectKindLine, ProjectMeta } from '../_projects/project-card'

/**
 * One trashed project: what it was, when it was trashed, and the two ways out.
 *
 * ## Restore is complete
 *
 * A form posting `restoreProject`. The action checks membership, clears
 * `trashed_at`, revalidates the lists, and the row is gone on the re-render
 * because the trash query no longer returns it. Nothing client-side pretends
 * it happened before it has.
 *
 * ## Delete forever is a confirmation with nothing behind it
 *
 * AGENTS.md, When to ask first: "Delete or purge user data." The brief asks
 * for the UI and the confirmation now and the destructive path only after the
 * deletion semantics are ruled. So the dialog is real - a native `<dialog>`,
 * modal, Escape closes it, focus is trapped by the browser - and the button in
 * it posts `purgeProject`, which refuses in words the writer can read. The
 * refusal renders inside the dialog, where the person who asked is looking.
 *
 * The copy in the dialog states the *proposed* semantics, so that when they
 * are ruled the sentence either stands or is corrected, rather than being
 * written for the first time next to a working delete.
 *
 * `showModal()` rather than the `open` attribute: only the modal form gives
 * the `::backdrop`, the focus trap and inertness of the page behind. It is a
 * DOM call, which is why this is a Client Component at all.
 */

const Button = ({
  tone,
  children,
  type = 'button',
  onClick,
}: {
  readonly tone: 'quiet' | 'danger'
  readonly children: string
  readonly type?: 'button' | 'submit'
  readonly onClick?: () => void
}) => {
  const { pending } = useFormStatus()
  const toneClass =
    tone === 'danger'
      ? 'border-line2 text-ink3 hover:bg-del-bg hover:text-del'
      : 'border-line2 text-ink2 hover:bg-hover hover:text-ink'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending}
      className={`cursor-pointer rounded-chrome border bg-transparent px-[10px] py-[4px] text-11 disabled:cursor-default disabled:opacity-60 ${toneClass}`}
    >
      {pending && type === 'submit' ? 'Working…' : children}
    </button>
  )
}

export const TrashRow = ({ card, nowMs }: { readonly card: ProjectCard; readonly nowMs: number }) => {
  const [restoreResult, restoreAction] = useActionState(restoreProject, IDLE)
  const [purgeResult, purgeAction] = useActionState(purgeProject, IDLE)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { project } = card
  const now = new Date(nowMs)

  return (
    <li className="flex flex-col gap-[7px] border-b border-line2 py-[10px]">
      <div className="flex items-start gap-[12px]">
        <Glyph name={KIND_GLYPH[project.kind]} className="mt-[3px] w-[13px] text-center text-ink3" style={{ fontSize: 11 }} />
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <span className="truncate font-serif text-15 font-medium leading-[1.25] tracking-title">
            {project.title}
          </span>
          <ProjectKindLine card={card} />
          <ProjectMeta card={card} />
        </div>

        <form action={restoreAction} className="flex items-center gap-[8px]">
          <input type="hidden" name="projectId" value={project.id} />
          <Button tone="quiet" type="submit">
            Restore
          </Button>
        </form>
        <Button
          tone="danger"
          onClick={() => {
            dialog.current?.showModal()
          }}
        >
          Delete forever
        </Button>
      </div>

      {restoreResult.status === 'error' ? (
        <p role="alert" className="m-0 pl-[25px] text-10-5 text-del">
          {restoreResult.message}
        </p>
      ) : null}

      <div className="pl-[25px]">
        <EditedFooter iso={project.trashedAt ?? project.updatedAt} now={now} verb="Trashed" />
      </div>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(440px,92vw)] rounded-chrome border border-line bg-panel p-0 text-ink backdrop:bg-scrim"
      >
        <form action={purgeAction} className="flex flex-col">
          <div className="flex flex-col gap-[8px] px-[16px] pb-[12px] pt-[14px]">
            <h2 id={titleId} className="m-0 font-serif text-15 font-medium tracking-title">
              Delete “{project.title}” forever?
            </h2>
            <p className="m-0 text-11-5 leading-[1.55] text-ink2">
              This removes the project, its episodes, scripts, notes, revisions and every derived
              record. It cannot be undone, and there is no copy anywhere else.
            </p>
            {purgeResult.status === 'error' ? (
              <p
                role="alert"
                className="m-0 rounded-chrome border border-note-bg bg-note-bg px-[9px] py-[7px] text-11 leading-[1.5] text-ink"
              >
                {purgeResult.message}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-[8px] border-t border-line2 px-[16px] py-[10px]">
            <input type="hidden" name="projectId" value={project.id} />
            <Button
              tone="quiet"
              onClick={() => {
                dialog.current?.close()
              }}
            >
              Keep it
            </Button>
            <Button tone="danger" type="submit">
              Delete forever
            </Button>
          </div>
        </form>
      </dialog>
    </li>
  )
}
