'use client'

import type { ReactNode } from 'react'

/**
 * Two small pieces every record drawer draws beside `drawer-shell.tsx`'s
 * frame: a section's head - the 11.5px `--ink2` label with a note or a
 * link at its right (`Sluglines here · 15 in the script`, `Who's here ·
 * → Characters`) - and the foot's notice, a failure in `--live` beside the
 * buttons.
 */
export const SectionHead = ({ label, children }: { readonly label: string; readonly children?: ReactNode }) => (
  <div className="flex items-baseline gap-[8px]">
    <span className="flex-1 text-11-5 text-ink2">{label}</span>
    {children}
  </div>
)

export const DrawerNotice = ({ notice }: { readonly notice: string | null }) =>
  notice === null ? null : (
    <span className="min-w-0 flex-1 truncate text-11-5 text-live" role="alert" data-drawer-notice>
      {notice}
    </span>
  )
