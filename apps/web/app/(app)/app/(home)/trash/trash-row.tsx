'use client'

import type { ProjectCard } from '@folio/contracts'
import { useActionState, useId, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import { relativeTime } from '../../../../../lib/format/relative-time'
import { purgeProject, restoreProject } from '../../../../../lib/projects/actions'
import { IDLE } from '../../../../../lib/projects/result'
import { kindLine, statsLine } from '../../../../../lib/projects/view'
import { ProjectPreview } from '../_projects/project-preview'

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
      ? 'border-line2 text-ink3 hover:bg-live-bg hover:text-live'
      : 'border-line2 text-ink2 hover:bg-hover hover:text-ink'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending}
      className={`cursor-pointer rounded-[9px] border bg-transparent px-[11px] py-[5px] text-11-5 disabled:cursor-default disabled:opacity-60 ${toneClass}`}
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

  const trashedAt = project.trashedAt ?? project.updatedAt

  return (
    <li className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 p-[12px]">
      <div className="flex items-start gap-[13px]">
        <span className="w-[92px] flex-none overflow-hidden rounded-[8px] border border-line2">
          <span className="block scale-[.65] [transform-origin:top_left] [width:142px]">
            <ProjectPreview card={card} />
          </span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <span className="truncate text-15 font-medium leading-[1.25] tracking-title">{project.title}</span>
          <span className="folio-eyebrow text-10-5">{kindLine(card)}</span>
          <span className="tabular font-mono text-10-5 text-ink3">{statsLine(card)}</span>
          <span className="text-11-5 text-ink3">
            Trashed{' '}
            <time dateTime={trashedAt} title={new Date(trashedAt).toISOString()}>
              {relativeTime(trashedAt, now)}
            </time>
          </span>
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
        <p role="alert" className="m-0 text-10-5 text-live">
          {restoreResult.message}
        </p>
      ) : null}

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(440px,92vw)] rounded-panel border border-line bg-bg p-0 text-ink backdrop:bg-scrim"
      >
        <form action={purgeAction} className="flex flex-col">
          <div className="flex flex-col gap-[8px] px-[16px] pb-[12px] pt-[14px]">
            <h2 id={titleId} className="m-0 text-15 font-medium tracking-title">
              Delete “{project.title}” forever?
            </h2>
            <p className="m-0 text-11-5 leading-[1.55] text-ink2">
              This removes the project, its episodes, scripts, notes, revisions and every derived
              record. It cannot be undone, and there is no copy anywhere else.
            </p>
            {purgeResult.status === 'error' ? (
              <p
                role="alert"
                className="m-0 rounded-[9px] border border-warn-bg bg-warn-bg px-[9px] py-[7px] text-11 leading-[1.5] text-ink"
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
