'use client'

import { PROJECT_KINDS, PROJECT_TYPES } from '@folio/contracts'
import { SCRIPT_FORMATS } from '@folio/script'
import type { ScriptFormat } from '@folio/script'
import Link from 'next/link'
import { useActionState, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { createProject } from '../../../../../lib/projects/actions'
import {
  ASIAN_FORMAT_NOTICE,
  FORMAT_CONSEQUENCE,
  FORMAT_LABEL,
  FORMAT_META,
  PROJECT_TYPE_LABEL,
} from '../../../../../lib/projects/labels'
import { IDLE } from '../../../../../lib/projects/result'
import type { ProjectActionResult, ProjectField } from '../../../../../lib/projects/result'

/**
 * The first run: one card, the three axes, and the project at the end of it.
 *
 * `handoff-account-v2/` draws a three-step setup card - what you are making,
 * page format, invite your collaborators - with a progress bar per step.
 *
 * ## The third step is film or series, not invites
 *
 * There is no third choice to make about a workspace and there is no invite
 * to send: AGENTS.md, Constraints - "no transactional email provider", and
 * "team invites are share links generated in-app and copied by the inviter",
 * from **inside a project**, which does not exist yet on this screen. An
 * invite field here would collect an address nothing could mail.
 *
 * What the product genuinely needs a third answer for is `projectType`: film
 * or series decides whether every URL in the workspace carries an episode and
 * whether the episode board exists. It is the third axis
 * `CreateProjectInputSchema` requires, it has no default by ruling ("a project
 * whose format was assumed is a project whose page count is a guess"), and the
 * handoff's card had nowhere to put it. So it is step three, and the bar
 * below the title fills as each axis is answered - three steps, each of them
 * a real one.
 *
 * ## Nothing is preselected
 *
 * Every group starts empty and the server refuses a blank one. The `Continue`
 * button is disabled until all three are answered and a name is typed, so the
 * refusal is a backstop rather than the way the screen is meant to be used.
 */
export const FirstRun = ({ greeting }: { readonly greeting: string }) => {
  const [result, action] = useActionState(createProject, IDLE)
  const [kind, setKind] = useState('')
  const [projectType, setProjectType] = useState('')
  const [format, setFormat] = useState('')
  const titleId = useId()
  const loglineId = useId()

  const answered = [kind, projectType, format].filter((value) => value !== '').length

  return (
    <div className="flex justify-center px-[24px] pb-[44px] pt-[48px]">
      <form
        action={action}
        className="flex w-full max-w-[620px] flex-col overflow-hidden rounded-panel border border-line bg-s1"
      >
        <div className="flex items-center gap-[12px] px-[20px] pb-[12px] pt-[18px]">
          <span className="flex-1 text-17 font-normal tracking-title">{greeting}</span>
          <span className="tabular font-mono text-11 text-ink3">{answered} / 3</span>
        </div>
        <div className="flex gap-[5px] px-[20px] pb-[18px]">
          {[0, 1, 2].map((step) => (
            <div
              key={step}
              className="h-[3px] flex-1 rounded-[2px]"
              style={{ background: step < answered ? 'var(--accent)' : 'var(--s3)' }}
            />
          ))}
        </div>

        <div className="flex flex-col gap-[22px] px-[20px] pb-[20px]">
          <p className="m-0 text-13 leading-[1.6] text-ink2">
            Three choices decide the workspace you land in. Every project begins here, and each of
            them can be changed later except the page format, which the pagination engine reads.
          </p>

          <label className="flex flex-col gap-[7px]" htmlFor={titleId}>
            <span className="folio-eyebrow text-10-5">Name</span>
            <input
              id={titleId}
              name="title"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              autoFocus
              placeholder="What is it called?"
              className="folio-field h-[38px] rounded-[11px] border-line bg-s1 text-13-5"
            />
            <FieldError result={result} owns="title" />
          </label>

          <fieldset className="m-0 flex flex-col gap-[9px] border-none p-0">
            <legend className="folio-eyebrow p-0 text-10-5">What are you making</legend>
            {PROJECT_KINDS.map((value) => (
              <Option
                key={value}
                name="kind"
                value={value}
                title={value === 'screenwriting' ? 'A screenplay' : 'A filmmaking project'}
                chosen={kind === value}
                onChoose={() => {
                  setKind(value)
                }}
              >
                {value === 'screenwriting'
                  ? 'Feature, series or short. Opens on a script sheet; scenes, characters and locations are derived from what you write.'
                  : 'A list and a way in, for now. What a filmmaking workspace opens on is still being decided, so opening one brings you back to the list.'}
              </Option>
            ))}
            <FieldError result={result} owns="kind" />
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-[9px] border-none p-0">
            <legend className="folio-eyebrow p-0 text-10-5">Film or series</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-[10px]">
              {PROJECT_TYPES.map((value) => (
                <Option
                  key={value}
                  name="projectType"
                  value={value}
                  title={PROJECT_TYPE_LABEL[value]}
                  chosen={projectType === value}
                  onChoose={() => {
                    setProjectType(value)
                  }}
                >
                  {value === 'film'
                    ? 'One document. The address carries no episode.'
                    : 'Episodes are first-class. Each has its own script, and the address carries the episode.'}
                </Option>
              ))}
            </div>
            <FieldError result={result} owns="projectType" />
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-[9px] border-none p-0">
            <legend className="folio-eyebrow p-0 text-10-5">Page format</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-[10px]">
              {SCRIPT_FORMATS.map((value: ScriptFormat) => (
                <Option
                  key={value}
                  name="format"
                  value={value}
                  title={FORMAT_LABEL[value]}
                  sheet={value}
                  chosen={format === value}
                  onChoose={() => {
                    setFormat(value)
                  }}
                >
                  <span className="tabular font-mono text-10-5 text-ink3">{FORMAT_META[value]}</span>
                  {value === 'asian' ? (
                    <>
                      <br />
                      {ASIAN_FORMAT_NOTICE}
                    </>
                  ) : null}
                </Option>
              ))}
            </div>
            <span className="text-12 leading-[1.5] text-ink3">{FORMAT_CONSEQUENCE}</span>
            <FieldError result={result} owns="format" />
          </fieldset>

          <label className="flex flex-col gap-[7px]" htmlFor={loglineId}>
            <span className="folio-eyebrow text-10-5">What it is about</span>
            <textarea
              id={loglineId}
              name="logline"
              rows={2}
              maxLength={600}
              placeholder="Optional. One or two sentences, shown on the project card."
              className="folio-field min-h-[54px] resize-y rounded-[11px] border-line bg-s1 text-13 leading-[1.5]"
            />
            <FieldError result={result} owns="logline" />
          </label>

          <p className="m-0 rounded-card border border-dashed border-line px-[13px] py-[11px] text-12 leading-[1.5] text-ink3">
            Collaborators come later, and they come as a link: Folio sends no mail, so a writer
            joins by opening a share link you copy from inside the project.
          </p>
        </div>

        <div className="flex items-center gap-[8px] border-t border-line2 bg-s1 px-[20px] py-[13px]">
          <span className="flex-1 text-12 text-ink3">
            Creates the project and its first episode, then opens it.
          </span>
          <Link href="/app/projects" className="folio-pill-button h-[32px] rounded-pill px-[13px] text-12-5 leading-[30px]">
            Skip
          </Link>
          <Continue ready={answered === 3} />
        </div>

        {result.status === 'error' && (result.field === 'form' || result.field === 'file') ? (
          <p role="alert" className="m-0 border-t border-line2 px-[20px] py-[10px] text-11-5 text-live">
            {result.message}
          </p>
        ) : null}
      </form>
    </div>
  )
}

/**
 * One choice: a `<label>` around a visually hidden native radio, styled
 * through `:has(:checked)`. Keyboard navigation, grouping and the accessible
 * name are the browser's - AGENTS.md, Deliberately not using: a radio group
 * is forty lines, not a component library.
 */
const Option = ({
  name,
  value,
  title,
  sheet,
  chosen,
  onChoose,
  children,
}: {
  readonly name: string
  readonly value: string
  readonly title: string
  /** A format option draws the sheet it means, in proportion. */
  readonly sheet?: ScriptFormat
  readonly chosen: boolean
  readonly onChoose: () => void
  readonly children: React.ReactNode
}) => (
  <label className="flex cursor-pointer items-start gap-[12px] rounded-card border border-line2 p-[13px] has-checked:border-accent-line has-checked:bg-accent-bg has-focus-visible:shadow-[0_0_0_2px_var(--focus)] hover:border-line">
    <input type="radio" name={name} value={value} required className="sr-only" onChange={onChoose} />
    {sheet === undefined ? (
      <span
        aria-hidden="true"
        className="mt-[2px] h-[14px] w-[14px] flex-none rounded-full border"
        style={{
          borderColor: chosen ? 'var(--accent)' : 'var(--line)',
          background: chosen ? 'var(--accent)' : 'transparent',
        }}
      />
    ) : (
      <span
        aria-hidden="true"
        className="flex-none rounded-[3px] border border-line2 bg-sunk"
        style={{ width: 28, height: sheet === 'asian' ? 39 : 36 }}
      />
    )}
    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-13-5">{title}</span>
      <span className="text-12-5 leading-[1.5] text-ink2">{children}</span>
    </span>
  </label>
)

const FieldError = ({ result, owns }: { readonly result: ProjectActionResult; readonly owns: ProjectField }) =>
  result.status === 'error' && result.field === owns ? (
    <p className="m-0 text-10-5 text-live" role="alert">
      {result.message}
    </p>
  ) : null

const Continue = ({ ready }: { readonly ready: boolean }) => {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || !ready}
      title={ready ? undefined : 'Answer all three, and name it.'}
      className="folio-solid-button h-[32px] rounded-pill px-[15px] text-12-5 font-medium"
    >
      {pending ? 'Creating…' : 'Continue'}
    </button>
  )
}
