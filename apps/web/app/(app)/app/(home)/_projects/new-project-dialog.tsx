'use client'

import { PROJECT_TYPES } from '@folio/contracts'
import type { ProjectKind } from '@folio/contracts'
import { SCRIPT_FORMATS } from '@folio/script'
import { Icon } from '@folio/ui'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { createProject } from '../../../../../lib/projects/actions'
import {
  ASIAN_FORMAT_NOTICE,
  FORMAT_LABEL,
  FORMAT_META,
  FORMAT_SHEET,
  KIND_LABEL,
  PROJECT_TYPE_LABEL,
} from '../../../../../lib/projects/labels'
import { IDLE } from '../../../../../lib/projects/result'
import type { ProjectField } from '../../../../../lib/projects/result'

/**
 * `New script` - the dialog behind the dashed card on the Projects grid, and
 * behind the compose box's send button on `/app/new`.
 *
 * `handoff-account-v2/README.md`: "cover-art slot, name field, optional
 * .fdx/.fountain/.pdf import, page-format switch, Create script."
 *
 * ## A native `<dialog>`, not a portal
 *
 * `showModal()` gives the `::backdrop`, the focus trap, Escape, and inertness
 * of the page behind - four behaviours that are otherwise four hooks. The
 * Trash route's confirmation has used one since the shell routes were built;
 * this is the same pattern with the surface card's chrome on it.
 *
 * ## What it collects, and the one thing the handoff leaves out
 *
 * `CreateProjectInputSchema` takes three axes and a title, and **none of them
 * has a default** - "a project whose format was assumed is a project whose
 * page count is a guess" (`new-project-form.tsx`, the ruling this dialog
 * inherits). The handoff's dialog collects a name and a page format, and says
 * nothing about film or series, so the film/series switch is added here
 * rather than guessed: it decides whether the project's URLs carry an episode
 * and whether the episode board exists, and it is not a default's to make.
 *
 * `kind` comes in from the caller - the dashed card and the compose box each
 * know which they are offering - and is posted in a hidden field, so the two
 * entry points cannot disagree with the button that opened them.
 *
 * The cover-art slot is drawn and takes no file: projects have no cover image
 * anywhere in the schema, and inventing one is a product decision and a
 * storage decision (AGENTS.md, When to ask first). It says so on the slot.
 *
 * The import is real: the attached file goes to `importScript`, the one
 * import path, and `.pdf` is not on its list - Folio reads `.fdx` and
 * `.fountain`, and the accept list says exactly that rather than promising a
 * format the parser does not have.
 */
export const NewProjectDialog = ({
  open,
  kind,
  logline = '',
  onClose,
}: {
  readonly open: boolean
  readonly kind: ProjectKind
  /** Carried in from the compose box, when a project began there. */
  readonly logline?: string
  readonly onClose: () => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const [result, action] = useActionState(createProject, IDLE)
  const [projectType, setProjectType] = useState<string>('')
  const [format, setFormat] = useState<string>('')
  const [file, setFile] = useState<string | null>(null)
  const titleId = useId()
  const loglineId = useId()

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  const errorFor = (field: ProjectField): string | null =>
    result.status === 'error' && result.field === field ? result.message : null

  return (
    <dialog
      ref={dialog}
      data-new-project
      aria-label="New project"
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(520px,92vw)] rounded-panel border border-line bg-bg p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-[3px]"
    >
      <form action={action} className="flex flex-col">
        <input type="hidden" name="kind" value={kind} />

        <div
          className="relative grid h-[150px] flex-none place-items-center border-b border-line2"
          style={{
            background:
              'repeating-linear-gradient(135deg, var(--s2) 0 8px, transparent 8px 16px), linear-gradient(160deg, var(--frame-a), var(--frame-b))',
          }}
        >
          <span className="px-[20px] text-center font-mono text-10-5 tracking-[.06em] text-frame-ink/60">
            cover art — projects have none yet
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="folio-ghost-button absolute right-[11px] top-[11px] grid h-[26px] w-[26px] place-items-center rounded-full bg-scrim text-frame-ink"
          >
            <Icon name="close" size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-[18px] p-[20px]">
          <div className="flex flex-col gap-[6px]">
            <h2 className="m-0 text-20 font-normal tracking-page">
              New {KIND_LABEL[kind].toLocaleLowerCase()} project
            </h2>
            <p className="m-0 text-12-5 leading-[1.6] text-ink2">
              Three choices decide the workspace you land in: what you are making, whether it is one
              film or a series, and the page format the script is measured on.
            </p>
          </div>

          <label className="flex flex-col gap-[7px]" htmlFor={titleId}>
            <span className="folio-eyebrow text-10-5">Name</span>
            <input
              id={titleId}
              name="title"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              placeholder="Enter a name…"
              aria-invalid={errorFor('title') !== null}
              className="folio-field h-[38px] rounded-[11px] border-line bg-s1 text-13-5"
            />
            <FieldError message={errorFor('title')} />
          </label>

          <label className="flex flex-col gap-[7px]" htmlFor={loglineId}>
            <span className="folio-eyebrow text-10-5">What it is about</span>
            <textarea
              id={loglineId}
              name="logline"
              defaultValue={logline}
              maxLength={600}
              rows={2}
              placeholder="One or two sentences. Shown on the project card."
              className="folio-field min-h-[54px] resize-y rounded-[11px] border-line bg-s1 text-13 leading-[1.5]"
            />
            <FieldError message={errorFor('logline')} />
          </label>

          <div className="flex flex-col gap-[7px]">
            <div className="flex items-baseline gap-[10px]">
              <span className="folio-eyebrow flex-1 text-10-5">Or import a draft</span>
              <span className="font-mono text-10-5 text-ink3">optional</span>
            </div>
            <label className="folio-pill-button flex h-[38px] cursor-pointer items-center justify-center gap-[9px] rounded-[11px] border-dashed border-line text-12-5">
              <Icon name="file" size={15} strokeWidth={1.4} />
              {file ?? 'Choose a .fdx or .fountain file'}
              <input
                type="file"
                name="file"
                accept=".fdx,.fountain,.txt"
                className="sr-only"
                onChange={(event) => {
                  setFile(event.target.files?.[0]?.name ?? null)
                }}
              />
            </label>
            <span className="text-11-5 leading-[1.5] text-ink3">
              Final Draft and Fountain. Title-page fields come across; generated text - the
              continueds and mores a layout adds - is stripped on the way in.
            </span>
            <FieldError message={errorFor('file')} />
          </div>

          <div className="flex flex-col gap-[7px]">
            <span className="folio-eyebrow text-10-5">Film or series</span>
            <div className="folio-pill-group self-start">
              {PROJECT_TYPES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={projectType === value}
                  onClick={() => {
                    setProjectType(value)
                  }}
                >
                  {PROJECT_TYPE_LABEL[value]}
                </button>
              ))}
            </div>
            <input type="hidden" name="projectType" value={projectType} />
            <FieldError message={errorFor('projectType')} />
          </div>

          <div className="flex flex-col gap-[7px]">
            <span className="folio-eyebrow text-10-5">Page format</span>
            <div className="folio-pill-group self-start">
              {SCRIPT_FORMATS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={format === value}
                  onClick={() => {
                    setFormat(value)
                  }}
                >
                  {FORMAT_LABEL[value]}
                  <span className="font-mono text-10-5 text-ink3">{FORMAT_SHEET[value]}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name="format" value={format} />
            <span className="text-11-5 leading-[1.5] text-ink3">
              {format === 'asian' ? ASIAN_FORMAT_NOTICE : 'An input to the pagination engine, not a print preference.'}
            </span>
            <FieldError message={errorFor('format')} />
          </div>
        </div>

        <div className="flex items-center gap-[9px] border-t border-line2 bg-s1 px-[20px] py-[13px]">
          <span className="tabular flex-1 font-mono text-10-5 text-ink3">
            {format === '' ? 'Choose a page format' : FORMAT_META[format === 'asian' ? 'asian' : 'hollywood']}
          </span>
          <button type="button" onClick={onClose} className="folio-pill-button h-[32px] rounded-pill px-[13px] text-12-5">
            Cancel
          </button>
          <Create />
        </div>

        {errorFor('form') === null ? null : (
          <p role="alert" className="m-0 border-t border-line2 px-[20px] py-[10px] text-11-5 text-live">
            {errorFor('form')}
          </p>
        )}
      </form>
    </dialog>
  )
}

const FieldError = ({ message }: { readonly message: string | null }) =>
  message === null ? null : (
    <p role="alert" className="m-0 text-10-5 leading-[1.5] text-live">
      {message}
    </p>
  )

const Create = () => {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="folio-solid-button h-[32px] rounded-pill px-[16px] text-12-5 font-medium">
      {pending ? 'Creating…' : 'Create project'}
    </button>
  )
}
