'use client'

import type { CharacterColor, CharacterGender, CharacterStatus, DraftField, SceneRef } from '@folio/contracts'
import { CHARACTER_COLORS, CHARACTER_GENDERS, CHARACTER_GENDER_LABELS, CHARACTER_STATUSES, CHARACTER_STATUS_LABELS } from '@folio/contracts'
import type { ReactNode } from 'react'

import { statusTone } from '../../../../../../lib/characters/cast'
import type { StatusOption } from '../_chrome/status-tabs'
import { StatusTabs } from '../_chrome/status-tabs'
import { Field, Section } from './drawer-shell'

/**
 * The fields both drawers author. `NameField` stands alone at the top of
 * the edit drawer (a changed name is a rename, not a profile field);
 * `ProfileFields` is the `Notes` fold - Role beside Age beside Gender
 * (`minmax(0,1fr) 84px 120px`); Description; Appearance; the ten colour
 * swatches; Wants; Needs (`Not written yet` while empty) - and the Status
 * segmented control (the shared `_chrome/status-tabs.tsx`).
 *
 * Under Description, Wants and Needs the edit drawer draws a `✦ Draft from
 * the script` row (`draftFrom`, the rebuild's phase 4): the assistant's
 * two or three cited sentences land in the field **unsaved**, for the
 * writer to keep with Save or not. Under Age, `ageHint` offers the age the
 * introducing action line gives (`38 on the page · E1 Sc 1 · Use this`).
 * The New drawer passes neither. A draft until Save: nothing here writes.
 */
export type ProfileDraft = {
  readonly name: string
  readonly role: string
  readonly age: string
  readonly gender: CharacterGender | ''
  readonly bio: string
  readonly appearance: string
  readonly color: CharacterColor
  readonly status: CharacterStatus
  readonly wants: string
  readonly needs: string
}

export const CHARACTER_STATUS_OPTIONS: readonly StatusOption<CharacterStatus>[] = CHARACTER_STATUSES.map((status) => ({
  id: status,
  label: CHARACTER_STATUS_LABELS[status],
  tone: statusTone(status),
}))

/** What one `✦ Draft from the script` row shows: idle, drafting, landed (with its citations), or refused with a reason. */
export type DraftState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'drafting' }
  | { readonly kind: 'drafted'; readonly refs: readonly SceneRef[]; readonly shown: number; readonly total: number }
  | { readonly kind: 'nothing'; readonly message: string }

export type DraftFrom = {
  /** Why the button is disabled, or null when it can be pressed. */
  readonly disabled: string | null
  readonly state: (field: DraftField) => DraftState
  readonly onDraft: (field: DraftField) => void
  /** The citations as chips: the drawer knows the project and shape, the fields do not. */
  readonly cite: (refs: readonly SceneRef[]) => ReactNode
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
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className="folio-drawer-field"
    />
  </Field>
)

const DraftRow = ({ field, draftFrom }: { readonly field: DraftField; readonly draftFrom: DraftFrom }) => {
  const state = draftFrom.state(field)
  const busy = state.kind === 'drafting'
  return (
    <div className="flex flex-wrap items-center gap-[8px]" data-draft-row={field}>
      <button
        type="button"
        data-draft-button={field}
        data-draft-state={state.kind}
        disabled={busy || draftFrom.disabled !== null}
        title={draftFrom.disabled ?? 'Two or three sentences from the scenes this character is in, cited. Nothing is saved until you press Save.'}
        onClick={() => {
          draftFrom.onDraft(field)
        }}
        className="folio-line-button flex h-[26px] items-center gap-[6px] rounded-[7px] px-[9px] text-11-5 disabled:cursor-default disabled:opacity-50"
      >
        <span className="folio-mark text-accent">✦</span>
        {busy ? 'Drafting…' : 'Draft from the script'}
      </button>
      {state.kind === 'drafted' ? (
        <span className="flex min-w-0 flex-wrap items-center gap-[4px] text-11 text-ink3" data-draft-landed>
          drafted from {draftFrom.cite(state.refs)}
          <span>· not saved{state.shown < state.total ? ` · from ${String(state.shown)} of ${String(state.total)} scenes` : ''}</span>
        </span>
      ) : state.kind === 'nothing' ? (
        <span className="text-11 text-ink3" data-draft-nothing>
          {state.message}
        </span>
      ) : null}
    </div>
  )
}

export const ProfileFields = ({
  draft,
  onChange,
  busy,
  draftFrom,
  ageHint,
}: {
  readonly draft: ProfileDraft
  readonly onChange: (next: ProfileDraft) => void
  readonly busy: boolean
  readonly draftFrom?: DraftFrom
  /** The age the page gives (`38 on the page · E1 Sc 1`), with the chip the drawer made for the scene. */
  readonly ageHint?: { readonly age: number; readonly cite: ReactNode }
}) => {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  const drafting = (field: DraftField): boolean => draftFrom?.state(field).kind === 'drafting'
  return (
    <>
      <div className="flex flex-col gap-[11px]">
        <div className="grid gap-[9px]" style={{ gridTemplateColumns: 'minmax(0, 1fr) 84px 120px' }}>
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
        </div>
        {ageHint === undefined || draft.age.trim() === String(ageHint.age) ? null : (
          <span className="flex flex-wrap items-center gap-[6px] text-11 text-ink3" data-age-hint={ageHint.age}>
            {ageHint.age} on the page · {ageHint.cite} ·
            <button
              type="button"
              data-age-use
              disabled={busy}
              onClick={() => {
                set('age', String(ageHint.age))
              }}
              className="text-accent hover:underline"
            >
              Use this
            </button>
          </span>
        )}
        <Field label="Description">
          <textarea
            value={draft.bio}
            disabled={busy || drafting('bio')}
            aria-busy={drafting('bio')}
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
        </Field>
        {draftFrom === undefined ? null : <DraftRow field="bio" draftFrom={draftFrom} />}
        <Field label="Appearance">
          <textarea
            value={draft.appearance}
            disabled={busy}
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
        </Field>
        <Field label="Wants">
          <textarea
            value={draft.wants}
            disabled={busy || drafting('wants')}
            aria-busy={drafting('wants')}
            data-field="wants"
            data-kind="line"
            rows={2}
            placeholder="Not written yet"
            onChange={(event) => {
              set('wants', event.target.value)
            }}
            className="folio-drawer-field"
            style={{ textWrap: 'pretty' }}
          />
        </Field>
        {draftFrom === undefined ? null : <DraftRow field="wants" draftFrom={draftFrom} />}
        <Field label="Needs">
          <textarea
            value={draft.needs}
            disabled={busy || drafting('needs')}
            aria-busy={drafting('needs')}
            data-field="needs"
            data-kind="line"
            rows={2}
            placeholder="Not written yet"
            onChange={(event) => {
              set('needs', event.target.value)
            }}
            className="folio-drawer-field"
            style={{ textWrap: 'pretty' }}
          />
        </Field>
        {draftFrom === undefined ? null : <DraftRow field="needs" draftFrom={draftFrom} />}
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
      </div>

      <Section gap={8}>
        <span className="text-11-5 text-ink2">Status</span>
        <StatusTabs
          label="Status"
          options={CHARACTER_STATUS_OPTIONS}
          value={draft.status}
          busy={busy}
          onChange={(status) => {
            set('status', status)
          }}
        />
      </Section>
    </>
  )
}
