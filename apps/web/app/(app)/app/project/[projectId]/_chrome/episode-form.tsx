'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { FormEvent } from 'react'

import { createEpisode, renameEpisode } from '../../../../../../lib/workspace/actions'
import { defaultEpisodeTitle } from '../../../../../../lib/workspace/format'

/**
 * The one form behind `New episode…` and `Rename episode…`: a name, a
 * primary button, Cancel. It draws no popover of its own - the header's
 * episode menu and the sidebar's `+` each place it in their own `folio-menu`
 * box - so the two entry points cannot drift apart.
 *
 * Creation takes the name the writer typed, or the default the placeholder
 * shows (`Episode N`) when they typed nothing: pressing Enter on an empty
 * field is "just add one", which is what the old `+` did without asking.
 * Rename refuses an empty name; there is no default to fall back to that
 * would not surprise.
 *
 * The action returns the episode and its script URL rather than
 * redirecting, so a refusal is drawn here under the field. On `done` a
 * creation navigates to the new episode's script; a rename refreshes in
 * place - the sidebar's title, the breadcrumb menu and the toolbar's title
 * are all server-drawn from the row.
 */
export type EpisodeFormMode =
  | { readonly kind: 'create'; readonly nextOrdinal: number }
  | { readonly kind: 'rename'; readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }

export const EpisodeForm = ({
  projectId,
  mode,
  onDone,
  onCancel,
}: {
  readonly projectId: ProjectId
  readonly mode: EpisodeFormMode
  readonly onDone: () => void
  readonly onCancel: () => void
}) => {
  const router = useRouter()
  const [name, setName] = useState(mode.kind === 'rename' ? mode.title : '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

  const ordinal = mode.kind === 'create' ? mode.nextOrdinal : mode.ordinal
  const placeholder = defaultEpisodeTitle(ordinal)
  const trimmed = name.trim()
  const unchanged = mode.kind === 'rename' && trimmed === mode.title.trim()
  const disabled = pending || (mode.kind === 'rename' && trimmed.length === 0)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (disabled) return
    if (unchanged) {
      onDone()
      return
    }
    setError(null)
    startTransition(async () => {
      const result =
        mode.kind === 'create'
          ? await createEpisode(projectId, trimmed.length === 0 ? null : trimmed)
          : await renameEpisode(projectId, mode.slug, trimmed)
      if (result.status === 'error') {
        setError(result.message)
        return
      }
      onDone()
      if (mode.kind === 'create') router.push(result.href)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} data-episode-form={mode.kind} className="flex flex-col gap-[10px] p-[6px]">
      <label className="flex flex-col gap-[6px]">
        <span className="text-13-5 font-medium">{mode.kind === 'create' ? 'New episode' : `Rename ${placeholder}`}</span>
        <input
          ref={field}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onCancel()
            }
          }}
          placeholder={placeholder}
          maxLength={200}
          aria-label="Episode name"
          data-episode-name
          disabled={pending}
          className="folio-field w-full"
        />
      </label>
      {mode.kind === 'create' ? (
        <p className="m-0 text-12 leading-[1.5] text-ink3">
          Leave it blank to call it {placeholder}. It opens on its script.
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="m-0 text-12 text-live">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-[6px]">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="folio-ghost-button rounded-[8px] px-[10px] py-[6px] text-12-5 text-ink2"
        >
          Cancel
        </button>
        <button type="submit" disabled={disabled} className="folio-solid-button h-[32px] rounded-[9px] px-[12px] text-12-5 font-medium">
          {pending ? (mode.kind === 'create' ? 'Creating…' : 'Renaming…') : mode.kind === 'create' ? 'Create episode' : 'Rename'}
        </button>
      </div>
    </form>
  )
}
