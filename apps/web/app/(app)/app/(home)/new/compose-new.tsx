'use client'

import { PROJECT_KINDS } from '@folio/contracts'
import type { ProjectKind } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { useRef, useState } from 'react'

import { KIND_LABEL } from '../../../../../lib/projects/labels'
import { NewProjectDialog } from '../_projects/new-project-dialog'

/**
 * The compose box: describe what you are making, and open the project.
 *
 * `handoff-account-v2/README.md`, "New": "Centered chat box: greeting, prompt
 * area with blinking caret, control row (Attach, Screenwriting ↔ Filmmaking,
 * format hint, credit cost) with the send button pinned bottom-right, prompt
 * chips below."
 *
 * ## What the box collects, and what it does not
 *
 * The sentence in it becomes the project's **logline** - the line the card
 * prints under the title. It is not a prompt: there is no agent at this
 * route, nothing reads it back, and a box that looked like one would be
 * promising a feature that does not exist (AGENTS.md, Development philosophy
 * 10). The label above it says what it is for.
 *
 * Send opens the dialog with the sentence already in it, because a project
 * cannot be created without the one thing the box does not collect - a title -
 * and two of the three axes. That is the same `NewProjectDialog` the Projects
 * grid opens, so there is one creation form in the product, not two.
 *
 * ## The chips are real starts, not sample prompts
 *
 * The handoff's chips read `Format a draft`, `Break a story`, `Write a scene`.
 * Each of those is an instruction to an assistant, and the assistant here is
 * per project and read-only. So the chips do the honest version of what they
 * name: they open the same dialog set up the way that phrase implies - the
 * import ready, the kind switched. A chip that filled the box with a sentence
 * the writer did not write would be worse than no chip.
 */
export const ComposeNew = ({ greeting }: { readonly greeting: string }) => {
  const [kind, setKind] = useState<ProjectKind>('screenwriting')
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  const open = (): void => {
    setCreating(true)
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-[22px] px-[24px] py-[40px]">
      <div className="flex w-full max-w-[740px] flex-col gap-[7px] text-center">
        <h2 className="m-0 text-31 font-light leading-[1.15] tracking-page">{greeting}</h2>
        <p className="m-0 text-13-5 leading-[1.6] text-ink2">
          Describe what you&rsquo;re making. Folio opens the project in the right format and keeps
          parsing scenes, characters and locations as you write.
        </p>
      </div>

      <form
        className="flex w-full max-w-[740px] flex-col gap-[14px] rounded-[17px] border border-line bg-s1 px-[16px] pb-[12px] pt-[16px]"
        onSubmit={(event) => {
          event.preventDefault()
          open()
        }}
      >
        <label className="flex flex-col gap-[6px] text-left">
          <span className="sr-only">What you are making</span>
          <textarea
            ref={box}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
            rows={2}
            maxLength={600}
            placeholder="A six-episode series about a magician's assistant who inherits the act"
            className="folio-composer min-h-[72px] text-15-5"
          />
          <span className="text-11 text-ink3">
            This becomes the project&rsquo;s logline - the line its card prints. You can change it
            later.
          </span>
        </label>

        <div className="flex items-end gap-[10px]">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[8px]">
            <button
              type="button"
              onClick={open}
              className="folio-pill-button flex h-[30px] items-center gap-[7px] rounded-[9px] px-[11px] text-12-5"
            >
              <Icon name="clip" size={14} strokeWidth={1.4} />
              Attach a draft
            </button>
            <div className="folio-pill-group" role="group" aria-label="What you are making">
              {PROJECT_KINDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => {
                    setKind(value)
                  }}
                >
                  {KIND_LABEL[value]}
                </button>
              ))}
            </div>
            <span className="text-11-5 text-ink3">
              {kind === 'screenwriting'
                ? 'Free — writing never costs credits'
                : 'A list and a way in; the workspace is an open decision'}
            </span>
          </div>
          <button
            type="submit"
            title="Name the project"
            aria-label="Name the project"
            className="folio-solid-button grid h-[34px] w-[34px] flex-none place-items-center rounded-full"
          >
            <Icon name="send" size={15} strokeWidth={1.6} />
          </button>
        </div>
      </form>

      <div className="flex w-full max-w-[740px] flex-wrap justify-center gap-[7px]">
        <Chip
          label="Import a draft"
          onClick={() => {
            setKind('screenwriting')
            open()
          }}
        />
        <Chip
          label="Start a screenplay"
          onClick={() => {
            setKind('screenwriting')
            open()
          }}
        />
        <Chip
          label="Start a filmmaking project"
          onClick={() => {
            setKind('filmmaking')
            open()
          }}
        />
      </div>

      <NewProjectDialog
        open={creating}
        kind={kind}
        logline={text}
        onClose={() => {
          setCreating(false)
        }}
      />
    </div>
  )
}

const Chip = ({ label, onClick }: { readonly label: string; readonly onClick: () => void }) => (
  <button type="button" onClick={onClick} className="folio-chip h-[29px] px-[13px]">
    {label}
  </button>
)
