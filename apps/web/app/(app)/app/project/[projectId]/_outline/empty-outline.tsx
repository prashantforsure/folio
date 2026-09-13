/**
 * The Outline's empty state, in two pieces the workspace places on the
 * prose sheet under the title.
 *
 * `empty` is a data state - no outline document exists for the episode -
 * decided on the server, never by a URL. There is no button and no import:
 * nothing in Fountain or FDX is an outline, and the caret line *is* the
 * editor, over one blank Body block minted on the client. The first save
 * creates the document (`lib/outline/actions.ts`). Until the editor mounts
 * (`immediatelyRender: false`, so only after hydration) `EmptyCaretLine`
 * draws the same line as static text so nothing shifts when it does.
 */

/** The caret line before the editor exists: the ghost's copy, at the ghost's geometry. */
export const EmptyCaretLine = () => (
  <div className="folio-outline-editable" aria-hidden="true">
    <div className="folio-outline-block" data-type="body">
      <span className="folio-outline-ghost">
        Type, or press <b>/</b> for a block<i>|</i>
      </span>
      {/* The line's height, as ProseMirror's trailing break gives an empty block its own. */}
      <br />
    </div>
  </div>
)

/** The bundle's note under the caret line, drawn until the first save. */
export const EmptyOutlineNote = () => (
  <p className="m-0 mt-[28px] px-[96px] font-sans text-10-5 leading-[1.5] text-ink3" data-empty-note>
    The prose plan for the episode — logline, synopsis, story beats. Its own document, on the same sheet; the script is
    never rewritten from this page.
  </p>
)
