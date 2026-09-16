import type { InlineContent, OutlineNode } from '@folio/script'
import { BEAT_HEADLINE_SEPARATOR } from '@folio/script'
import type { ReactNode } from 'react'

import type { LabelFor } from '../../../../../../../lib/script/inline'

/**
 * The outline before the editor exists: the same blocks, at the same
 * geometry, as plain HTML - the Script route's `static-sheet.tsx` over the
 * seven.
 *
 * Tiptap is created after hydration (`immediatelyRender: false`), so the
 * server would otherwise send an empty sheet. This renders the node list
 * the way the editor will - `div.folio-outline-block[data-type]`, the beat
 * numbers, the bold lead, the mentions by their label - so the first paint
 * is the outline and the editor's arrival changes nothing on screen -
 * the caret line's ghost included, on a trailing empty block.
 * Read-only; no handler, no state. Its blocks carry `data-static-id`, not
 * `data-node-id`, so the E2E walk waits for the real editor.
 */

const Runs = ({ content, labelFor, lead }: { readonly content: InlineContent; readonly labelFor: LabelFor; readonly lead: boolean }) => {
  // An empty block keeps a line's height, as ProseMirror's trailing break gives it one.
  if (content.every((run) => run.kind === 'text' && run.text === '')) return <br />
  const out: ReactNode[] = []
  let leadOpen = lead
  content.forEach((run, index) => {
    if (run.kind === 'mention') {
      out.push(
        <span key={index} className={leadOpen ? 'folio-mention folio-outline-lead' : 'folio-mention'} data-entity={run.target.entity} data-id={run.target.id}>
          {labelFor(run.target.entity, run.target.id) ?? '?'}
        </span>,
      )
      return
    }
    if (!leadOpen) {
      out.push(<span key={index}>{run.text}</span>)
      return
    }
    const at = run.text.indexOf(BEAT_HEADLINE_SEPARATOR)
    if (at === -1) {
      out.push(
        <span key={index} className="folio-outline-lead">
          {run.text}
        </span>,
      )
      return
    }
    leadOpen = false
    out.push(
      <span key={`${String(index)}:lead`} className="folio-outline-lead">
        {run.text.slice(0, at + 1)}
      </span>,
      <span key={`${String(index)}:rest`}>{run.text.slice(at + 1)}</span>,
    )
  })
  return <>{out}</>
}

const hasLead = (content: InlineContent): boolean =>
  content.some((run) => run.kind === 'text' && run.text.includes(BEAT_HEADLINE_SEPARATOR))

const isEmptyBody = (node: OutlineNode): boolean =>
  node.type === 'body' && node.content.every((run) => run.kind === 'text' && run.text === '')

/** The caret line's promise, as the editor's ghost decoration draws it (`extensions/decorations.ts`). */
export const OutlineGhost = ({ alone }: { readonly alone: boolean }) =>
  alone ? (
    <span className="folio-outline-ghost" aria-hidden="true">
      <i />
      Start typing, or type &apos;/&apos; to add a block
    </span>
  ) : (
    <span className="folio-outline-ghost" aria-hidden="true">
      Type, or press <b>/</b> for a block<i />
    </span>
  )

export const StaticOutline = ({ nodes, labelFor }: { readonly nodes: readonly OutlineNode[]; readonly labelFor: LabelFor }) => {
  let ordinal = 0
  const last = nodes[nodes.length - 1]
  const ghostOn = last !== undefined && isEmptyBody(last) ? last.id : null
  return (
    <div className="folio-outline-editable" data-static-sheet="" aria-hidden="true">
      {nodes.map((node) => {
        if (node.type === 'rule') {
          return (
            <div key={node.id} className="folio-outline-block" data-type="rule" data-static-id={node.id}>
              <span className="folio-outline-rule" />
            </div>
          )
        }
        if (node.type === 'quote') {
          return (
            <div key={node.id} className="folio-outline-block" data-type="quote" data-static-id={node.id}>
              <div className="folio-outline-quote">
                <Runs content={node.content} labelFor={labelFor} lead={false} />
              </div>
            </div>
          )
        }
        if (node.type === 'beat') ordinal += 1
        return (
          <div key={node.id} className="folio-outline-block" data-type={node.type} data-static-id={node.id}>
            {node.type === 'beat' ? <span className="folio-outline-marker">{ordinal}</span> : null}
            {ghostOn === node.id ? <OutlineGhost alone={nodes.length === 1} /> : null}
            <Runs content={node.content} labelFor={labelFor} lead={node.type === 'beat' && hasLead(node.content)} />
          </div>
        )
      })}
    </div>
  )
}
