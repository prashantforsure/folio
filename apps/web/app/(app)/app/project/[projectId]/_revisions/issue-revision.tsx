'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import type { RevisionColour } from '@folio/script'
import { RevisionSwatch } from '@folio/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'

import { issueRevision } from '../../../../../../lib/revisions/actions'

/**
 * `⊕ Issue revision`, and the form behind it.
 *
 * The button is the bundle's accent button, without its `⊕`: the glyph is
 * outside AGENTS.md's set, and the Scenes header set the precedent of leaving
 * such a glyph off rather than adding one without a human looking. The form
 * is not in the bundle - it draws the button and nothing after it - so it is
 * the smallest thing
 * that collects what a revision row holds: a label (defaulting to
 * `Draft N`), the note that goes out with the paper, tags, and whether to
 * lock the pages in the same act. The colour is not asked for: it is the
 * next in sequence, shown rather than chosen, because AGENTS.md puts the
 * sequence behind an explicit decision and a picker would be that decision
 * handed to whoever clicks.
 *
 * Past green the button still opens the form, and the form says why it
 * cannot issue: `previewNextRevision` reports the refusal ahead of the
 * write, in the pure core's own words.
 *
 * ## Colour names in copy
 *
 * `White pages`, `Blue pages` - the industry spelling, capitalised, as the
 * bundle's history cards print them. The swatch beside it is `RevisionSwatch`,
 * the one sanctioned way to put a revision colour on screen.
 */

export const colourName = (colour: RevisionColour): string =>
  colour.charAt(0).toUpperCase() + colour.slice(1)

type NextPreview =
  | { readonly ok: true; readonly ordinal: number; readonly colour: RevisionColour }
  | { readonly ok: false; readonly after: RevisionColour; readonly detail: string }

export const IssueRevisionControl = ({
  projectId,
  episode,
  next,
  hasScript,
}: {
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  readonly next: NextPreview | null
  readonly hasScript: boolean
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [lock, setLock] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)
  const labelId = useId()

  const defaultLabel = next !== null && next.ok ? `Draft ${String(next.ordinal)}` : ''

  // Hydrated, for the walk: a click before this is replayed into nothing.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const submit = (): void => {
    const finalLabel = label.trim() === '' ? defaultLabel : label.trim()
    setMessage(null)
    start(async () => {
      const result = await issueRevision({
        projectId,
        episode,
        label: finalLabel,
        note,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ''),
        lock,
      })
      if (result.status === 'issued') {
        setOpen(false)
        setLabel('')
        setNote('')
        setTags('')
        setLock(false)
        router.refresh()
        return
      }
      setMessage(result.message)
    })
  }

  return (
    <div
      className="relative flex-none"
      ref={panelRef}
      data-issue-revision-control
      data-mounted={mounted ? 'true' : 'false'}
    >
      <button
        type="button"
        disabled={!hasScript}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((value) => !value)
        }}
        title={hasScript ? undefined : 'There is no script to issue yet'}
        className="folio-focus flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome border-0 bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        data-issue-revision
      >
        Issue revision
      </button>

      {open ? (
        <div
          role="dialog"
          aria-labelledby={labelId}
          className="absolute right-0 top-[calc(100%+6px)] z-[6] flex w-[340px] flex-col gap-[10px] rounded-chrome border border-line bg-panel p-[14px]"
          style={{ boxShadow: 'var(--shadow)' }}
          data-issue-form
        >
          <div className="flex items-center gap-[8px]">
            <span id={labelId} className="font-serif text-15 font-medium tracking-title">
              Issue revision
            </span>
            {next !== null && next.ok ? (
              <span className="ml-auto flex items-center gap-[6px] text-10-5 text-ink2">
                <RevisionSwatch colour={next.colour} size={8} />
                {colourName(next.colour)} pages
              </span>
            ) : null}
          </div>

          {next !== null && !next.ok ? (
            <p className="m-0 text-11 leading-[1.5] text-ink2" data-sequence-exhausted>
              The colour sequence ends at {colourName(next.after)}. {next.detail}
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-[4px] text-10 text-ink3">
                Label
                <input
                  value={label}
                  placeholder={defaultLabel}
                  maxLength={120}
                  onChange={(event) => {
                    setLabel(event.target.value)
                  }}
                  className="rounded-chrome border border-line bg-transparent px-[8px] py-[5px] text-12 text-ink"
                />
              </label>
              <label className="flex flex-col gap-[4px] text-10 text-ink3">
                Note — goes out with the paper
                <textarea
                  value={note}
                  rows={3}
                  maxLength={4000}
                  onChange={(event) => {
                    setNote(event.target.value)
                  }}
                  className="resize-y rounded-chrome border border-line bg-transparent px-[8px] py-[5px] text-12 leading-[1.5] text-ink"
                />
              </label>
              <label className="flex flex-col gap-[4px] text-10 text-ink3">
                Tags, comma-separated
                <input
                  value={tags}
                  placeholder="Sc 2, table read"
                  onChange={(event) => {
                    setTags(event.target.value)
                  }}
                  className="rounded-chrome border border-line bg-transparent px-[8px] py-[5px] text-12 text-ink"
                />
              </label>
              <label className="flex items-center gap-[7px] text-11 text-ink2">
                <input
                  type="checkbox"
                  checked={lock}
                  onChange={(event) => {
                    setLock(event.target.checked)
                  }}
                />
                Lock pages — they keep their numbers from here on
              </label>
              {message === null ? null : (
                <p className="m-0 text-10-5 leading-[1.5] text-del" role="alert">
                  {message}
                </p>
              )}
              <div className="flex items-center justify-end gap-[6px]">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                  }}
                  className="folio-focus rounded-chrome border border-line bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={submit}
                  className="folio-focus rounded-chrome border-0 bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
                  data-issue-submit
                >
                  {pending ? 'Issuing…' : `Issue ${label.trim() === '' ? (defaultLabel === '' ? 'revision' : defaultLabel) : label.trim()}`}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
