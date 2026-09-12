'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

/**
 * A line of authored text that edits in place.
 *
 * Every field an entity route authors - a character's role, age, the
 * one-line, a drive and its source; a location's description and its arc
 * note - is this: the text as a button when it is not being edited (or the
 * placeholder in `--ink3` when it is empty), an input or textarea when it
 * is, saved on Enter or blur if it changed, abandoned on Escape. One
 * component so every field on both routes behaves the same way and the
 * bundle's typography is set at the call site, not re-invented per field.
 *
 * Here rather than in a route directory because two routes use it -
 * AGENTS.md, Conventions > Files: "Anything used by two routes moves to
 * `packages/ui`." Presentational: it knows nothing about what it edits.
 *
 * `onSave` receives the trimmed text; an empty string means "clear" and
 * the caller decides what that stores (the actions store `null`).
 */
export const Editable = ({
  value,
  placeholder,
  onSave,
  multiline = false,
  className = '',
  inputClassName = '',
  label,
  ariaLabel,
}: {
  readonly value: string | null
  readonly placeholder: string
  readonly onSave: (next: string) => void
  readonly multiline?: boolean
  readonly className?: string
  readonly inputClassName?: string
  /** Rendered as the button's accessible name when the text is the value. */
  readonly label?: string
  readonly ariaLabel?: string
}) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [editing, value])

  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next !== (value ?? '')) onSave(next)
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(value ?? '')
      setEditing(false)
      return
    }
    if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commit()
    }
  }

  if (!editing) {
    const empty = value === null || value === ''
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true)
        }}
        aria-label={ariaLabel ?? label ?? placeholder}
        title="Click to edit"
        className={`m-0 cursor-text border-none bg-transparent p-0 text-left font-[inherit] ${
          empty ? 'text-ink3' : ''
        } hover:text-ink ${className}`}
        data-editable={empty ? 'empty' : 'set'}
      >
        {empty ? placeholder : value}
      </button>
    )
  }

  const shared = {
    value: draft,
    onChange: (event: { readonly target: { readonly value: string } }) => {
      setDraft(event.target.value)
    },
    onBlur: commit,
    onKeyDown: onKey,
    'aria-label': ariaLabel ?? label ?? placeholder,
    className: `m-0 w-full rounded-chrome border border-accent-line bg-sheet p-0 px-[4px] font-[inherit] text-ink outline-none ${className} ${inputClassName}`,
  }
  return multiline ? (
    <textarea
      ref={(node) => {
        ref.current = node
      }}
      rows={Math.max(2, Math.min(8, draft.split('\n').length + 1))}
      {...shared}
    />
  ) : (
    <input
      ref={(node) => {
        ref.current = node
      }}
      type="text"
      {...shared}
    />
  )
}
