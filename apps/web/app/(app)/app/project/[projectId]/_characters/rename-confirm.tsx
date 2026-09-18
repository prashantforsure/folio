'use client'

import type { CharacterId } from '@folio/script'

import type { RenamePreview } from '../../../../../../lib/characters/result'
import { count } from '../../../../../../lib/workspace/format'
import { ConflictBlock } from '../_chrome/conflict-block'

/**
 * The rename's confirm, fed by `previewRename`: what the sanctioned
 * write-back will rewrite (the cues per episode) and what it leaves alone
 * (every other bound spelling), before it is taken. Drawn in the drawer's
 * foot when the name field changed, and under a queue row's `or rename
 * Meera → MIRA`. One shape, two doors.
 *
 * With `taken` - the new spelling is already somebody's cue - the confirm
 * is a conflict block whose accept is the merge the refusal used to name
 * in prose. `onCreateInstead` (the drawer's door only): keep this record
 * as it is and make a new one under the typed name; nothing is rewritten.
 */
export const RenameConfirm = ({
  from,
  to,
  preview,
  busy,
  onConfirm,
  onKeep,
  onCreateInstead,
  onMerge,
}: {
  readonly from: string
  readonly to: string
  readonly preview: RenamePreview | null
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onKeep: () => void
  readonly onCreateInstead?: () => void
  readonly onMerge: (holder: CharacterId) => void
}) => {
  if (preview === null) {
    return (
      <span className="min-w-0 flex-1 text-12 text-ink2" data-rename-counting>
        Counting cues…
      </span>
    )
  }
  if (preview.status !== 'preview') {
    return (
      <>
        <span className="min-w-0 flex-1 text-12 leading-[1.45] text-live" role="alert" data-rename-error>
          {preview.message}
        </span>
        <button type="button" data-rename-cancel onClick={onKeep} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
          Keep the name
        </button>
      </>
    )
  }
  if (preview.taken !== null) {
    const holder = preview.taken
    return (
      <div className="min-w-0 flex-1" data-rename-taken={holder.by}>
        <ConflictBlock
          title={`${preview.to} is already ${holder.name}'s cue.`}
          detail="Renaming would put two records under one spelling. Merge this record into it instead, or keep the name."
          accept={`Merge into ${holder.name}`}
          deliberate="Keep the name"
          busy={busy}
          onAccept={() => {
            onMerge(holder.by)
          }}
          onDeliberate={onKeep}
        />
      </div>
    )
  }
  const perEpisode = preview.episodes.map((entry) => `E${String(entry.ordinal)} ${String(entry.cues)}`).join(' · ')
  const sentence =
    preview.cues === 0
      ? `No cue reads ${from.toUpperCase()} yet; the record's name changes and ${preview.to} becomes its spelling.`
      : `Rename everywhere? ${count(preview.cues)} ${preview.cues === 1 ? 'cue' : 'cues'} in the script will read ${preview.to}${preview.episodes.length > 1 ? `: ${perEpisode}` : ''}.`
  const stays =
    preview.stays.length === 0
      ? 'No other spelling is bound.'
      : `${count(preview.stays.length)} other ${preview.stays.length === 1 ? 'spelling stays' : 'spellings stay'} bound: ${preview.stays.join(', ')}.`
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px] text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }} data-rename-confirm>
        <span>{sentence}</span>
        <span className="text-11 text-ink3" data-rename-stays={preview.stays.length}>
          {stays}
        </span>
      </span>
      <button type="button" data-rename-cancel disabled={busy} onClick={onKeep} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
        Keep the name
      </button>
      {onCreateInstead === undefined ? null : (
        <button
          type="button"
          data-rename-create
          disabled={busy}
          onClick={onCreateInstead}
          title={`Keep ${from} as it is and create ${to} as a new character`}
          className="folio-ghost-button h-[34px] flex-none rounded-[9px] px-[10px] text-12 text-ink2"
        >
          Create a new character instead
        </button>
      )}
      <button type="button" data-rename-confirm-button disabled={busy} onClick={onConfirm} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[14px] text-12-5 font-medium">
        Rename
      </button>
    </>
  )
}
