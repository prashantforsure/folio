'use client'

import type { PropStatus } from '@folio/contracts'
import { PROP_STATUSES, PROP_STATUS_LABELS } from '@folio/contracts'

import { statusTone } from '../../../../../../lib/props/view'
import { Field } from '../_chrome/drawer-shell'
import { StatusTabs } from '../_chrome/status-tabs'
import type { StatusOption } from '../_chrome/status-tabs'

/**
 * The fields both drawers author: the name, the category and the
 * production fold (status, description).
 *
 * A draft until Save: nothing here writes.
 *
 * ## Category is an input with a datalist, not a select
 *
 * Ruling 5: free text, offered from the values the project already uses,
 * never an enum. A `<select>` would make the offered list the *only* list,
 * which is the enum this route is refusing; a plain input would offer
 * nothing and let `Hand prop` and `hand prop` become two groups. An input
 * with a `<datalist>` is exactly the ruling: type anything, and what
 * already exists is one keystroke away.
 */
export type PropDraft = {
  readonly name: string
  readonly category: string
  readonly description: string
  readonly status: PropStatus
}

export const EMPTY_DRAFT: PropDraft = { name: '', category: '', description: '', status: 'needed' }

export const STATUS_OPTIONS: readonly StatusOption<PropStatus>[] = PROP_STATUSES.map((status) => ({
  id: status,
  label: PROP_STATUS_LABELS[status],
  tone: statusTone(status),
}))

export const NameField = ({ value, busy, onChange }: { readonly value: string; readonly busy: boolean; readonly onChange: (value: string) => void }) => (
  <Field label="Prop name">
    <input
      type="text"
      value={value}
      disabled={busy}
      data-field="name"
      placeholder="Game Ball"
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className="folio-drawer-field"
    />
  </Field>
)

export const CategoryField = ({
  value,
  categories,
  busy,
  onChange,
}: {
  readonly value: string
  /** Every category the project already uses - what the list offers. */
  readonly categories: readonly string[]
  readonly busy: boolean
  readonly onChange: (value: string) => void
}) => (
  <Field label="Category">
    <>
      <input
        type="text"
        value={value}
        disabled={busy}
        list="prop-categories"
        data-field="category"
        placeholder="Hand prop, set dressing, costume…"
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="folio-drawer-field"
      />
      <datalist id="prop-categories">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </>
  </Field>
)

export const ProductionFields = ({
  draft,
  onChange,
  busy,
}: {
  readonly draft: PropDraft
  readonly onChange: (next: PropDraft) => void
  readonly busy: boolean
}) => {
  const set = <K extends keyof PropDraft>(key: K, value: PropDraft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex flex-col gap-[6px]">
        <span className="text-11-5 text-ink2">Status</span>
        <StatusTabs
          label="Status"
          options={STATUS_OPTIONS}
          value={draft.status}
          busy={busy}
          onChange={(status) => {
            set('status', status)
          }}
        />
      </div>
      <Field label="Description">
        <textarea
          value={draft.description}
          disabled={busy}
          data-field="description"
          data-kind="prose"
          rows={4}
          placeholder="What it is, and what the art department needs to know."
          onChange={(event) => {
            set('description', event.target.value)
          }}
          className="folio-drawer-field text-ink2"
          style={{ textWrap: 'pretty' }}
        />
      </Field>
    </div>
  )
}
