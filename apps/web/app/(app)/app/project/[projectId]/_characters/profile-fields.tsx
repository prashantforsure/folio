'use client'

import type { CharacterColor, CharacterGender } from '@folio/contracts'
import { CHARACTER_COLORS, CHARACTER_GENDERS, CHARACTER_GENDER_LABELS } from '@folio/contracts'

import { Field, Section } from './drawer-shell'

/**
 * The fields both drawers author (the fourth pass, 2026-09-20 - ruling 4:
 * the drawer is a form, like laper's). `NameField` stands at the top of
 * either drawer (in the edit drawer a changed name is a rename, not a
 * profile field); `ProfileFields` is the rest, in three sections:
 *
 *   Basic info        the ten colour swatches, Gender (`Not set / Female /
 *                     Male / Non-binary / Other`), Age, Role
 *   Bio               the description
 *   Appearance notes  the look, with the hint `Shapes the generated look`
 *                     - what the look-sheet job will read, when it exists
 *
 * A draft until Save: nothing here writes. The status, wants and needs
 * fields and the `✦ Draft from the script` rows went with the pass; the
 * columns stay (dropping them is ask-first) and the assistant's Focus
 * block still prints what an earlier pass wrote in them.
 */
export type ProfileDraft = {
  readonly name: string
  readonly role: string
  readonly age: string
  readonly gender: CharacterGender | ''
  readonly bio: string
  readonly appearance: string
  readonly color: CharacterColor
}

export const NameField = ({
  value,
  busy,
  onChange,
}: {
  readonly value: string
  readonly busy: boolean
  readonly onChange: (name: string) => void
}) => (
  <Field label="Name">
    <input
      type="text"
      value={value}
      disabled={busy}
      data-field="name"
      placeholder="Who they are called"
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className="folio-drawer-field"
    />
  </Field>
)

export const ProfileFields = ({
  draft,
  onChange,
  busy,
  children,
}: {
  readonly draft: ProfileDraft
  readonly onChange: (next: ProfileDraft) => void
  readonly busy: boolean
  /** Drawn at the top of `Basic info`, before the swatches: the New drawer's name field. */
  readonly children?: React.ReactNode
}) => {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  return (
    <>
      <div className="flex flex-col gap-[11px]" data-drawer-section="basic">
        <span className="folio-eyebrow">Basic info</span>
        {children}
        <div className="flex flex-col gap-[6px]">
          <span className="text-11-5 text-ink2">Colour</span>
          <div role="radiogroup" aria-label="Colour" data-swatches className="flex flex-wrap items-center gap-[6px]">
            {CHARACTER_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                role="radio"
                aria-checked={draft.color === color.id}
                aria-pressed={draft.color === color.id}
                aria-label={color.name}
                title={color.name}
                data-swatch={color.id}
                disabled={busy}
                onClick={() => {
                  set('color', color.id)
                }}
                className="h-[16px] w-[16px] flex-none rounded-[4px] border border-line2 aria-pressed:ring-2 aria-pressed:ring-focus aria-pressed:ring-offset-1 aria-pressed:ring-offset-sunk"
                style={{ background: `var(--${color.id})` }}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-[9px]" style={{ gridTemplateColumns: '120px 84px minmax(0, 1fr)' }}>
          <Field label="Gender">
            <select
              value={draft.gender}
              disabled={busy}
              data-field="gender"
              onChange={(event) => {
                const value = event.target.value
                set('gender', value === '' ? '' : (value as CharacterGender))
              }}
              className="folio-drawer-field"
            >
              <option value="">Not set</option>
              {CHARACTER_GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {CHARACTER_GENDER_LABELS[gender]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Age">
            <input
              type="text"
              value={draft.age}
              disabled={busy}
              data-field="age"
              placeholder="—"
              onChange={(event) => {
                set('age', event.target.value)
              }}
              className="folio-drawer-field tabular"
            />
          </Field>
          <Field label="Role">
            <input
              type="text"
              value={draft.role}
              disabled={busy}
              data-field="role"
              placeholder="What they do"
              onChange={(event) => {
                set('role', event.target.value)
              }}
              className="folio-drawer-field truncate"
            />
          </Field>
        </div>
      </div>

      <Section gap={9}>
        <span className="folio-eyebrow">Bio</span>
        <textarea
          value={draft.bio}
          disabled={busy}
          aria-label="Bio"
          data-field="bio"
          data-kind="prose"
          rows={4}
          placeholder="Who they are, in a line or three."
          onChange={(event) => {
            set('bio', event.target.value)
          }}
          className="folio-drawer-field text-ink2"
          style={{ textWrap: 'pretty' }}
        />
      </Section>

      <Section gap={9}>
        <div className="flex items-baseline gap-[8px]">
          <span className="folio-eyebrow flex-1">Appearance notes</span>
          <span className="text-11 text-ink3">Shapes the generated look</span>
        </div>
        <textarea
          value={draft.appearance}
          disabled={busy}
          aria-label="Appearance notes"
          data-field="appearance"
          data-kind="prose"
          rows={3}
          placeholder="The look, in a line or two."
          onChange={(event) => {
            set('appearance', event.target.value)
          }}
          className="folio-drawer-field text-ink2"
          style={{ textWrap: 'pretty' }}
        />
      </Section>
    </>
  )
}
