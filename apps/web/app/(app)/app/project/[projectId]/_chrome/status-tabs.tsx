'use client'

/**
 * The drawer's status segmented control - `docs/ui design/README.md`,
 * "Status as a dot plus a pill": "Six-pixel dot in lists, coloured pill on
 * detail pages, segmented control in the drawer. Same colour throughout."
 * One button per status, `flex: 1`, 32px, a 6px dot in the status's tone;
 * the pressed one takes the tone's `-bg` and ink (`.folio-status-tab`,
 * `globals.css`). Handed the statuses with their labels and tones, so the
 * Characters drawer (`Draft · Defined · Locked`) and the Locations drawer
 * (`Pending · Scouted · Locked`) are one control.
 */
export type StatusOption<S extends string> = {
  readonly id: S
  readonly label: string
  readonly tone: 'warn' | 'ok' | 'accent'
}

export const StatusTabs = <S extends string>({
  label,
  options,
  value,
  busy,
  onChange,
}: {
  /** The group's accessible name: `Scouting status`. */
  readonly label: string
  readonly options: readonly StatusOption<S>[]
  readonly value: S
  readonly busy: boolean
  readonly onChange: (status: S) => void
}) => (
  <div className="flex items-center gap-[6px]" role="group" aria-label={label} data-status-control>
    {options.map((option) => (
      <button
        key={option.id}
        type="button"
        aria-pressed={value === option.id}
        data-status={option.id}
        data-tone={option.tone}
        disabled={busy}
        onClick={() => {
          onChange(option.id)
        }}
        className="folio-status-tab"
      >
        <span className="folio-tone-fill h-[6px] w-[6px] rounded-full" data-tone={option.tone} />
        {option.label}
      </button>
    ))}
  </div>
)
