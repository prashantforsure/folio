'use client'

import type { StoryThreadColour, StoryThreadEdit } from '@folio/contracts'
import { STORY_THREAD_COLOURS } from '@folio/contracts'
import { useState } from 'react'

import { threadColourVar } from '../../../../../../lib/timeline/view'

/**
 * The one form a thread is made or changed with: a name, the six colour
 * swatches, and the buttons. Drawn inline in the sidebar's Threads group,
 * under the row it edits or at the top for a new one - the smallest thing
 * that lets a writer author a thread. The `--sunk` field and the 14px
 * swatches, the chosen one ringed in `--ink` on the card's `--s1`.
 *
 * The colour names are the contract's closed set; a swatch's accessible
 * name is the name (`terracotta`), which is what the writer would call it.
 */
const COLOUR_LABEL: Readonly<Record<StoryThreadColour, string>> = {
  terracotta: 'Terracotta',
  slate: 'Slate',
  moss: 'Moss',
  ochre: 'Ochre',
  violet: 'Violet',
  teal: 'Teal',
}

export const ThreadEditor = ({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
  error,
  busy,
}: {
  readonly initial: StoryThreadEdit
  readonly submitLabel: string
  readonly onSubmit: (edit: StoryThreadEdit) => void
  readonly onCancel: () => void
  readonly onDelete?: () => void
  readonly error: string | null
  readonly busy: boolean
}) => {
  const [name, setName] = useState(initial.name)
  const [colour, setColour] = useState<StoryThreadColour>(initial.colour)
  const trimmed = name.trim()

  return (
    <form
      data-thread-editor
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed === '') return
        onSubmit({ name: trimmed, colour })
      }}
      className="flex flex-col gap-[8px] rounded-[10px] border border-line2 bg-s1 p-[8px]"
    >
      <input
        autoFocus
        type="text"
        value={name}
        maxLength={80}
        onChange={(event) => {
          setName(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
        placeholder="Thread name"
        aria-label="Thread name"
        className="folio-field min-w-0 text-12-5"
      />
      <div role="radiogroup" aria-label="Thread colour" className="flex gap-[6px] px-[2px]">
        {STORY_THREAD_COLOURS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === colour}
            aria-label={COLOUR_LABEL[option]}
            title={COLOUR_LABEL[option]}
            data-thread-swatch={option}
            onClick={() => {
              setColour(option)
            }}
            className="h-[14px] w-[14px] rounded-[4px] border-none p-0"
            style={{
              background: threadColourVar(option),
              boxShadow: option === colour ? '0 0 0 2px var(--s1), 0 0 0 3px var(--ink)' : 'none',
            }}
          />
        ))}
      </div>
      {error === null ? null : (
        <span role="alert" className="text-11 text-live" data-thread-editor-error>
          {error}
        </span>
      )}
      <div className="flex items-center gap-[6px]">
        <button type="submit" disabled={busy || trimmed === ''} data-thread-submit className="folio-solid-button h-[26px] rounded-[7px] px-[10px] text-11-5 font-medium">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="folio-line-button h-[26px] rounded-[7px] px-[9px] text-11-5">
          Cancel
        </button>
        <span className="flex-1" />
        {onDelete === undefined ? null : (
          <button type="button" disabled={busy} onClick={onDelete} data-delete-thread className="folio-delete-button h-[26px] rounded-[7px] px-[9px] text-11-5">
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
