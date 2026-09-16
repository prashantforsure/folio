import { OutlineGhost } from './editor/static-outline'

/**
 * The Outline's empty state, in the pieces the workspace places on the
 * column - `docs/ui design/Route - Outline v2.dc.html`, `content: empty`:
 * `Untitled outline` in `--ink3`, the caret line "Start typing, or type '/'
 * to add a block", and two key hints.
 *
 * `empty` is a data state - no outline document exists for the episode -
 * decided on the server, never by a URL. There is no button and no import:
 * nothing in Fountain or FDX is an outline, and the caret line *is* the
 * editor, over one blank Body block minted on the client. The first save
 * creates the document (`lib/outline/actions.ts`). Until the editor mounts
 * (`immediatelyRender: false`, so only after hydration) `EmptyCaretLine`
 * draws the same line as static text so nothing shifts when it does.
 */

const HINTS: readonly { readonly key: string; readonly text: string }[] = [
  { key: '/', text: 'Add a heading, quote, list or divider' },
  { key: '@', text: 'Mention a character or location to keep it linked' },
]

/** The caret line before the editor exists: the ghost's copy, at the ghost's geometry. */
export const EmptyCaretLine = () => (
  <div className="folio-outline-editable" aria-hidden="true">
    <div className="folio-outline-block" data-type="body">
      <OutlineGhost alone />
      {/* The line's height, as ProseMirror's trailing break gives an empty block its own. */}
      <br />
    </div>
  </div>
)

/** The two hints under the caret line, drawn until the first save. */
export const EmptyOutlineHints = () => (
  <div className="flex flex-col gap-[12px]" data-empty-note>
    {HINTS.map((hint) => (
      <div key={hint.key} className="flex items-baseline gap-[14px]">
        <span className="min-w-[34px] flex-none rounded-[8px] border border-line2 bg-s1 px-[9px] py-[4px] text-center font-mono text-11-5 text-ink2">
          {hint.key}
        </span>
        <span className="text-14 leading-[1.6] text-ink3">{hint.text}</span>
      </div>
    ))}
  </div>
)
