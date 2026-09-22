'use client'

import { artStyleNameCell, openSetup } from './view-state'

/**
 * §2.2, the header's settings chip: gear icon + the current art style's
 * name; opens Production Settings. Lives in the header the layout renders,
 * reads the name the workspace published (`view-state.tsx`).
 */
export const SettingsChip = () => {
  const name = artStyleNameCell.use()
  return (
    <button
      type="button"
      title="Production settings"
      aria-label={`Production settings: ${name ?? 'not set'}`}
      aria-haspopup="dialog"
      data-production-settings-chip
      onClick={openSetup}
      className="folio-prod-chip"
    >
      <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
        <circle cx="9" cy="9" r="2.6" />
        <path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M14.1 3.9l-1.4 1.4M5.3 12.7l-1.4 1.4" />
      </svg>
      <span className="truncate">{name ?? 'Production settings'}</span>
    </button>
  )
}
