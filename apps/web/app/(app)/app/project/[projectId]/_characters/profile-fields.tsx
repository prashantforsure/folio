'use client'

import type { CharacterStatus } from '@folio/contracts'
import { CHARACTER_STATUSES, CHARACTER_STATUS_LABELS } from '@folio/contracts'

import { statusTone } from '../../../../../../lib/characters/cast'
import { Field, Section } from './drawer-shell'

/**
 * The fields both drawers author - `Route - Characters v2.dc.html`'s edit
 * drawer, top to bottom: Name; Role beside Age (`minmax(0,1fr) 84px`);
 * Description (88px min); the Status segmented control (`Draft · Defined ·
 * Locked`, a 6px dot each, the tone's `-bg` and ink while pressed); Wants;
 * Needs (`Not written yet` while empty). The portrait row above and the
 * arc and relationships below are the edit drawer's alone.
 *
 * A draft until Save: nothing here writes.
 */
export type ProfileDraft = {
  readonly name: string
  readonly role: string
  readonly age: string
  readonly bio: string
  readonly status: CharacterStatus
  readonly wants: string
  readonly needs: string
}

export const ProfileFields = ({
  draft,
  onChange,
  busy,
}: {
  readonly draft: ProfileDraft
  readonly onChange: (next: ProfileDraft) => void
  readonly busy: boolean
}) => {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  return (
    <>
      <div className="flex flex-col gap-[11px]">
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            disabled={busy}
            data-field="name"
            onChange={(event) => {
              set('name', event.target.value)
            }}
            className="folio-drawer-field"
          />
        </Field>
        <div className="grid gap-[9px]" style={{ gridTemplateColumns: 'minmax(0, 1fr) 84px' }}>
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
        </div>
        <Field label="Description">
          <textarea
            value={draft.bio}
            disabled={busy}
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
      </div>

      <Section gap={8}>
        <span className="text-11-5 text-ink2">Status</span>
        <div className="flex items-center gap-[6px]" role="group" aria-label="Status" data-status-control>
          {CHARACTER_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={draft.status === status}
              data-status={status}
              data-tone={statusTone(status)}
              disabled={busy}
              onClick={() => {
                set('status', status)
              }}
              className="folio-status-tab"
            >
              <span className="folio-tone-fill h-[6px] w-[6px] rounded-full" data-tone={statusTone(status)} />
              {CHARACTER_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </Section>

      <Section>
        <Field label="Wants">
          <textarea
            value={draft.wants}
            disabled={busy}
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
        <Field label="Needs">
          <textarea
            value={draft.needs}
            disabled={busy}
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
      </Section>
    </>
  )
}
