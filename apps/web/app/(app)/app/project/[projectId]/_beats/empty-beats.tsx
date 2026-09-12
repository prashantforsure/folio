'use client'

/**
 * The Beats route's empty state. Two facts are told apart, because they are
 * different facts: an episode with no outline at all, and an outline with no
 * beat block in it. Both offer the one way in - `Add beat`, which writes a
 * beat block (and, with no outline, the outline it goes in). AGENTS.md: every
 * route ships both states, no exceptions.
 */
export const EmptyBeats = ({
  state,
  onAdd,
  pending,
}: {
  readonly state: 'no-outline' | 'beats' | 'unreadable'
  readonly onAdd: () => void
  readonly pending: boolean
}) => (
  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-[24px]" data-empty-state={state}>
    <div className="flex w-full max-w-[420px] flex-col gap-[10px] rounded-chrome border border-line bg-panel p-[20px]">
      <h2 className="m-0 font-serif text-21 font-medium tracking-title">{state === 'unreadable' ? 'The outline would not read' : 'No beats yet'}</h2>
      {state === 'unreadable' ? (
        <p className="m-0 text-11-5 leading-[1.55] text-ink2">
          Beats are the outline&rsquo;s numbered blocks, and a block in this outline does not read as one. Nothing can be
          listed over it.
        </p>
      ) : (
        <>
          <p className="m-0 text-11-5 leading-[1.55] text-ink2">
            {state === 'no-outline'
              ? 'Story structure as time — what happens when, in minutes. Beats are the outline’s numbered blocks; this episode has no outline yet, so there is nothing to place.'
              : 'Story structure as time — what happens when, in minutes. The outline has no numbered beat yet, so there is nothing to place.'}
          </p>
          <p className="m-0 text-11-5 leading-[1.55] text-ink2">
            A beat names the scenes that deliver it. A beat with no scenes is incomplete, not finished.
          </p>
          <div>
            <button
              type="button"
              data-add-first-beat
              disabled={pending}
              onClick={onAdd}
              className="folio-focus flex items-center gap-[6px] rounded-chrome bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink disabled:opacity-60"
            >
              <span className="text-11 opacity-75">＋</span>Add beat
            </button>
          </div>
        </>
      )}
    </div>
  </div>
)
