'use client'

import type { StoryThreadColour, StoryThreadEdit } from '@folio/contracts'
import { STORY_THREAD_COLOURS } from '@folio/contracts'
import { useState } from 'react'

import { threadColourVar } from './figures'

/**
 * The one form a thread is made or changed with: a name, the six colour
 * swatches, and the buttons. Drawn inline in the column, under the row it
 * edits or under the `Threads` label for a new one. The bundle draws no
 * such form - its threads are fixture - so this is the smallest thing that
 * lets a writer author one: 12px input on `--sheet`, 14px swatches, the
 * chosen one ringed in `--ink`.
 */
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
      className="flex flex-col gap-[8px] rounded-chrome border border-line bg-sheet px-[8px] pb-[8px] pt-[8px]"
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
        className="min-w-0 rounded-chrome border border-line2 bg-panel px-[8px] py-[5px] text-12 text-ink outline-none placeholder:text-ink3"
      />
      <div role="radiogroup" aria-label="Thread colour" className="flex gap-[6px]">
        {STORY_THREAD_COLOURS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === colour}
            aria-label={option}
            title={option}
            onClick={() => {
              setColour(option)
            }}
            className="h-[14px] w-[14px] rounded-[3px] border-none p-0"
            style={{
              background: threadColourVar(option),
              boxShadow: option === colour ? '0 0 0 2px var(--panel), 0 0 0 3px var(--ink)' : 'none',
            }}
          />
        ))}
      </div>
      {error === null ? null : <span className="text-10-5 text-del">{error}</span>}
      <div className="flex gap-[6px]">
        <button
          type="submit"
          disabled={busy || trimmed === ''}
          className="rounded-chrome border-none bg-accent px-[10px] py-[4px] text-11 font-semibold text-accent-ink disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-chrome border border-line2 bg-transparent px-[10px] py-[4px] text-11 text-ink2 hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <span className="flex-1" />
        {onDelete === undefined ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            data-delete-thread
            className="rounded-chrome border border-line2 bg-transparent px-[10px] py-[4px] text-11 text-del hover:bg-del-bg disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
