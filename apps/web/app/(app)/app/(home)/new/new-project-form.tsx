'use client'

import { PROJECT_KINDS, PROJECT_TYPES } from '@folio/contracts'
import type { ProjectKind, ProjectType } from '@folio/contracts'
import { SCRIPT_FORMATS } from '@folio/script'
import type { ScriptFormat } from '@folio/script'
import { Glyph } from '@folio/ui'
import { useActionState, useId } from 'react'
import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

import { createProject } from '../../../../../lib/projects/actions'
import {
  ASIAN_FORMAT_NOTICE,
  FORMAT_CONSEQUENCE,
  FORMAT_LABEL,
  FORMAT_META,
  KIND_GLYPH,
  KIND_LABEL,
  PROJECT_TYPE_LABEL,
} from '../../../../../lib/projects/labels'
import { IDLE } from '../../../../../lib/projects/result'
import type { ProjectActionResult, ProjectField } from '../../../../../lib/projects/result'

/**
 * The creation form. A title and the three axes, nothing else.
 *
 * ## Nothing is preselected
 *
 * The brief: `/app/new` "must collect THREE AXES before it can create
 * anything, because they decide the whole workspace the user lands in." A
 * preselected radio is a value the writer did not choose, and for `format`
 * in particular - which sets the page count - a default is a guess about
 * pagination made on their behalf. So each group starts empty, the browser's
 * `required` asks for a choice, and the server refuses a blank one too. An
 * assumption; the competitor observation preselects screenwriting and
 * Hollywood.
 *
 * ## Radio cards, not a component library
 *
 * Each option is a `<label>` wrapping a visually hidden native radio, styled
 * through the `:has(:checked)` and `:has(:focus-visible)` variants. Keyboard
 * navigation, grouping and the accessible name are the browser's; nothing is
 * re-implemented. AGENTS.md, Deliberately not using: no opinionated component
 * library, and this is the case for it - a radio group is forty lines.
 *
 * ## Copy
 *
 * There is no Folio design bundle for this route; the six files added to
 * `docs/ui design/` today are observations of a competitor. Their format
 * caption - "It only sets page geometry, not how you write" - is the sentence
 * AGENTS.md contradicts, so the copy here is written from the contract instead:
 * `FORMAT_CONSEQUENCE` says what format does to the page, and
 * `ASIAN_FORMAT_NOTICE` discloses open decision 8 where the choice is made.
 */

const KIND_COPY: Record<ProjectKind, string> = {
  screenwriting:
    'A screenplay. Opens on a script sheet; scenes, characters and locations are derived from what you write.',
  filmmaking:
    'A project list and a way in, for now. What a filmmaking workspace opens on is still being decided.',
}

const PROJECT_TYPE_COPY: Record<ProjectType, string> = {
  film: 'One document. No episode board, and the address carries no episode.',
  series: 'Episodes are first-class. Each has its own script, and the address carries the episode.',
}

const FieldError = ({ result, owns }: { readonly result: ProjectActionResult; readonly owns: ProjectField }) =>
  result.status === 'error' && result.field === owns ? (
    <p className="m-0 text-10-5 text-del" role="alert">
      {result.message}
    </p>
  ) : null

const Legend = ({ children, hint }: { readonly children: string; readonly hint?: string }) => (
  <div className="flex flex-col gap-[3px]">
    <legend className="p-0 text-9-5 font-semibold uppercase tracking-label text-ink3">{children}</legend>
    {hint === undefined ? null : <p className="m-0 text-10-5 leading-[1.5] text-ink2">{hint}</p>}
  </div>
)

const OptionCard = ({
  name,
  value,
  title,
  glyph,
  children,
}: {
  readonly name: string
  readonly value: string
  readonly title: string
  readonly glyph?: ReactNode
  readonly children: ReactNode
}) => (
  <label className="flex cursor-pointer items-start gap-[10px] rounded-chrome border border-line2 p-[11px] has-checked:border-accent-line has-checked:bg-accent-bg has-focus-visible:shadow-[0_0_0_2px_var(--focus)] hover:border-line">
    <input type="radio" name={name} value={value} required className="sr-only" />
    {glyph === undefined ? null : (
      <span className="w-[14px] flex-none text-center text-13 text-ink2">{glyph}</span>
    )}
    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-12-5 font-medium">{title}</span>
      <span className="text-11 leading-[1.5] text-ink2">{children}</span>
    </span>
  </label>
)

const Submit = () => {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="cursor-pointer rounded-chrome border-none bg-accent px-[14px] py-[6px] text-11-5 font-medium text-accent-ink disabled:cursor-default disabled:opacity-60"
    >
      {pending ? 'Creating…' : 'Create project'}
    </button>
  )
}

export const NewProjectForm = () => {
  const [result, action] = useActionState(createProject, IDLE)
  const titleId = useId()
  const titleInvalid = result.status === 'error' && result.field === 'title'

  return (
    <form action={action} className="flex flex-col rounded-chrome border border-line bg-panel">
      <div className="flex flex-col gap-[16px] p-[16px]">
        <div className="flex flex-col gap-[5px]">
          <label htmlFor={titleId} className="text-9-5 font-semibold uppercase tracking-label text-ink3">
            Title
          </label>
          <input
            id={titleId}
            name="title"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            autoFocus
            aria-invalid={titleInvalid}
            className="rounded-chrome border border-line bg-sheet px-[9px] py-[7px] text-12-5 text-sheet-ink aria-[invalid=true]:border-del"
          />
          <FieldError result={result} owns="title" />
        </div>

        <fieldset className="m-0 flex flex-col gap-[8px] border-none p-0">
          <Legend>What are you making</Legend>
          {PROJECT_KINDS.map((kind) => (
            <OptionCard
              key={kind}
              name="kind"
              value={kind}
              title={KIND_LABEL[kind]}
              glyph={<Glyph name={KIND_GLYPH[kind]} />}
            >
              {KIND_COPY[kind]}
            </OptionCard>
          ))}
          <FieldError result={result} owns="kind" />
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-[8px] border-none p-0">
          <Legend>Film or series</Legend>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[8px]">
            {PROJECT_TYPES.map((projectType) => (
              <OptionCard
                key={projectType}
                name="projectType"
                value={projectType}
                title={PROJECT_TYPE_LABEL[projectType]}
              >
                {PROJECT_TYPE_COPY[projectType]}
              </OptionCard>
            ))}
          </div>
          <FieldError result={result} owns="projectType" />
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-[8px] border-none p-0">
          <Legend hint={FORMAT_CONSEQUENCE}>Page format</Legend>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[8px]">
            {SCRIPT_FORMATS.map((format: ScriptFormat) => (
              <OptionCard key={format} name="format" value={format} title={FORMAT_LABEL[format]}>
                <span className="font-mono text-10 text-ink3">{FORMAT_META[format]}</span>
                {format === 'asian' ? (
                  <>
                    <br />
                    {ASIAN_FORMAT_NOTICE}
                  </>
                ) : null}
              </OptionCard>
            ))}
          </div>
          <FieldError result={result} owns="format" />
        </fieldset>
      </div>

      <div className="flex items-center gap-[8px] border-t border-line2 px-[16px] py-[12px]">
        <p className="m-0 flex-1 text-10-5 text-ink3">
          Creates the project and its first episode, then opens it.
        </p>
        <Submit />
      </div>
      {result.status === 'error' && result.field === 'form' ? (
        <p role="alert" className="m-0 border-t border-line2 px-[16px] py-[10px] text-11-5 text-del">
          {result.message}
        </p>
      ) : null}
    </form>
  )
}
