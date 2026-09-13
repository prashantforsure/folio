'use client'

import type { CharacterColor, CharacterGender } from '@folio/contracts'
import { CHARACTER_COLORS, CHARACTER_GENDERS, CHARACTER_GENDER_LABELS } from '@folio/contracts'
import { useEffect, useRef, useState } from 'react'

/**
 * The fields a character is authored with, shared by the New Character
 * modal and the edit drawer so both ask the same questions in the same
 * order: Basic info (name, colour, gender, age, role), then Bio, then
 * Appearance notes. Controlled by a `Draft` the caller owns; this draws
 * and reports, and saves nothing.
 */

export type Draft = {
  readonly name: string
  readonly color: CharacterColor
  readonly gender: CharacterGender | null
  readonly age: string
  readonly role: string
  readonly bio: string
  readonly appearance: string
}

export const emptyDraft = (color: CharacterColor): Draft => ({
  name: '',
  color,
  gender: null,
  age: '',
  role: '',
  bio: '',
  appearance: '',
})

const FIELD =
  'w-full rounded-chrome border border-line2 bg-sheet px-[11px] py-[8px] text-12 text-ink outline-none placeholder:text-ink3 focus:border-accent-line'

const LABEL = 'text-11 text-ink2'

export const Panel = ({
  title,
  note,
  children,
}: {
  readonly title: string
  readonly note?: string
  readonly children: React.ReactNode
}) => (
  <section className="overflow-hidden rounded-card border border-line bg-panel">
    <header className="flex flex-col gap-[2px] border-b border-line2 px-[16px] pb-[10px] pt-[12px]">
      <span className="text-12 font-semibold text-ink">{title}</span>
      {note === undefined ? null : <span className="text-10-5 text-ink3">{note}</span>}
    </header>
    <div className="flex flex-col gap-[14px] px-[16px] pb-[16px] pt-[14px]">{children}</div>
  </section>
)

export const CharacterFields = ({
  draft,
  onChange,
  nameAutoFocus = false,
}: {
  readonly draft: Draft
  readonly onChange: (next: Draft) => void
  readonly nameAutoFocus?: boolean
}) => {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  return (
    <>
      <Panel title="Basic info">
        <label className="flex flex-col gap-[6px]">
          <span className={LABEL}>Name</span>
          <input
            autoFocus={nameAutoFocus}
            type="text"
            value={draft.name}
            onChange={(event) => {
              set('name', event.target.value)
            }}
            placeholder="Character 1"
            aria-label="Name"
            data-field="name"
            className={FIELD}
          />
        </label>
        <div className="flex flex-col gap-[6px]">
          <span className={LABEL}>Color</span>
          <ColorPicker
            value={draft.color}
            onChange={(color) => {
              set('color', color)
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-[12px]">
          <label className="flex flex-col gap-[6px]">
            <span className={LABEL}>Gender</span>
            <select
              value={draft.gender ?? ''}
              onChange={(event) => {
                const value = event.target.value
                set('gender', (CHARACTER_GENDERS as readonly string[]).includes(value) ? (value as CharacterGender) : null)
              }}
              aria-label="Gender"
              data-field="gender"
              className={FIELD}
            >
              <option value="">Not set</option>
              {CHARACTER_GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {CHARACTER_GENDER_LABELS[gender]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className={LABEL}>Age</span>
            <input
              type="text"
              value={draft.age}
              onChange={(event) => {
                set('age', event.target.value)
              }}
              placeholder="e.g. 28"
              aria-label="Age"
              data-field="age"
              className={FIELD}
            />
          </label>
        </div>
        <label className="flex flex-col gap-[6px]">
          <span className={LABEL}>Role/Identity</span>
          <input
            type="text"
            value={draft.role}
            onChange={(event) => {
              set('role', event.target.value)
            }}
            placeholder="Enter role or identity…"
            aria-label="Role/Identity"
            data-field="role"
            className={FIELD}
          />
        </label>
      </Panel>

      <Panel title="Bio">
        <textarea
          value={draft.bio}
          onChange={(event) => {
            set('bio', event.target.value)
          }}
          placeholder="Describe the character's background, experiences, motivations…"
          aria-label="Bio"
          data-field="bio"
          rows={5}
          className={`${FIELD} resize-y leading-[1.5]`}
        />
      </Panel>

      <Panel title="Appearance Notes" note="This will influence AI-generated character images">
        <textarea
          value={draft.appearance}
          onChange={(event) => {
            set('appearance', event.target.value)
          }}
          placeholder="Build, face, hair, what they wear…"
          aria-label="Appearance Notes"
          data-field="appearance"
          rows={4}
          className={`${FIELD} resize-y leading-[1.5]`}
        />
      </Panel>
    </>
  )
}

/**
 * The colour picker: a button showing the current swatch and name, and a
 * popover of the ten `--chip-N` colours. Names come from the contract;
 * the swatch reads the token, so no hex is written here.
 */
export const ColorPicker = ({
  value,
  onChange,
}: {
  readonly value: CharacterColor
  readonly onChange: (next: CharacterColor) => void
}) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('mousedown', close)
    }
  }, [open])
  const current = CHARACTER_COLORS.find((color) => color.id === value) ?? CHARACTER_COLORS[0]

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Color: ${current.name}`}
        data-color-picker
        onClick={() => {
          setOpen((state) => !state)
        }}
        className="flex items-center gap-[10px] rounded-full border border-line2 bg-sheet py-[6px] pl-[8px] pr-[14px] text-12 text-ink hover:bg-hover"
      >
        <span className="h-[18px] w-[18px] rounded-full" style={{ background: `var(--chip-${String(current.hue)})` }} />
        {current.name}
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Colors"
          className="absolute left-0 top-[38px] z-20 grid w-[280px] grid-cols-2 gap-[2px] rounded-card border border-line bg-panel p-[6px] shadow-[0_8px_24px_var(--scrim)]"
        >
          {CHARACTER_COLORS.map((color) => (
            <li key={color.id}>
              <button
                type="button"
                role="option"
                aria-selected={color.id === value}
                data-color-option={color.id}
                onClick={() => {
                  onChange(color.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-[8px] rounded-chrome px-[8px] py-[6px] text-left text-11-5 hover:bg-hover ${
                  color.id === value ? 'bg-sel text-ink' : 'text-ink2'
                }`}
              >
                <span className="h-[14px] w-[14px] flex-none rounded-full" style={{ background: `var(--chip-${String(color.hue)})` }} />
                {color.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
