'use client'

import type { ShotRow } from '@folio/contracts'
import type { ReactElement } from 'react'
import { useRef, useState } from 'react'

import { useDismiss } from '../../_chrome/use-dismiss'

/**
 * The card's `⋯`: Edit, Move left / right, then the picture - Upload image,
 * Clear image - then Remove (or, for a proposal, Discard).
 *
 * Upload opens a hidden file input; the file goes to `onUploadFrame` and
 * the row comes back pointing at it. Without the `R2_*` block the item is
 * drawn disabled and its title says why, rather than hidden: the writer
 * should learn what the product does, not wonder. Clear is only for a
 * frame that was uploaded; a drawn one is regenerated, not cleared.
 */
export const NodeMenu = ({
  shot,
  index,
  count,
  pending,
  storage,
  onEdit,
  onMove,
  onUpload,
  onClear,
  onRemove,
}: {
  readonly shot: ShotRow
  readonly index: number
  readonly count: number
  readonly pending: boolean
  readonly storage: boolean
  readonly onEdit: () => void
  readonly onMove: (direction: 'up' | 'down') => void
  readonly onUpload: (file: File) => void
  readonly onClear: () => void
  readonly onRemove: () => void
}) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  useDismiss(open, () => setOpen(false), root)

  const item = (
    label: string,
    attrs: Readonly<Record<`data-${string}`, string>>,
    act: () => void,
    options: { readonly disabled?: boolean; readonly title?: string | undefined; readonly tone?: string } = {},
  ): ReactElement => (
    <button
      type="button"
      role="menuitem"
      {...attrs}
      disabled={pending || options.disabled === true}
      title={options.title}
      className={`folio-menu-item ${options.tone ?? ''}`}
      onClick={() => {
        setOpen(false)
        act()
      }}
    >
      {label}
    </button>
  )

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        title="Shot actions"
        aria-label="Shot actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-node-menu
        className="folio-pill-button grid h-full w-[34px] place-items-center rounded-[10px] text-15 leading-none !text-ink3"
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        ⋯
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-upload-frame-input
        onChange={(event) => {
          const picked = event.target.files?.[0]
          event.target.value = ''
          if (picked !== undefined) onUpload(picked)
        }}
      />
      {open ? (
        <div role="menu" className="folio-menu absolute bottom-[40px] right-0 w-[210px]">
          {item('Edit', { 'data-edit-shot': '' }, onEdit)}
          {item('Move left', { 'data-move-shot': 'up' }, () => onMove('up'), { disabled: index === 0 })}
          {item('Move right', { 'data-move-shot': 'down' }, () => onMove('down'), { disabled: index >= count - 1 })}
          <div className="mt-[2px] border-t border-line2 pt-[4px]">
            {item('Upload image', { 'data-upload-frame': '' }, () => file.current?.click(), {
              disabled: !storage || shot.state === 'proposed',
              title: !storage ? 'Frame storage is not set up on this server yet.' : shot.state === 'proposed' ? 'Accept the shot first.' : 'PNG, JPEG or WebP, up to 5 MB',
            })}
            {item('Clear image', { 'data-clear-frame': '' }, onClear, {
              disabled: shot.frameUploadUrl === null,
              title: shot.frameUploadUrl === null ? 'No uploaded image on this shot.' : undefined,
            })}
          </div>
          <div className="mt-[2px] border-t border-line2 pt-[4px]">
            {shot.state === 'proposed'
              ? item('Discard', { 'data-discard-shot': '' }, onRemove, { tone: '!text-live' })
              : item('Remove', { 'data-delete-shot': '' }, onRemove, { tone: '!text-live' })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
