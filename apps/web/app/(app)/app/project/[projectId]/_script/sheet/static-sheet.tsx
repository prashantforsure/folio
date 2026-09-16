import type { InlineContent, MeasurementRecord, ScreenplayNode } from '@folio/script'
import type { ReactNode } from 'react'

import type { LabelFor } from '../../../../../../../lib/script/inline'
import type { PageBreak } from '../../../../../../../lib/script/pages'
import { pageBreaksByNode, pageBreaksOf } from '../../../../../../../lib/script/pages'

/**
 * The page before the editor exists: the same blocks, in the same DOM, as
 * plain HTML.
 *
 * Tiptap is created after hydration (`immediatelyRender: false`), so the
 * server would otherwise send an empty surface and a hundred-page draft
 * would paint blank. This renders the node list the way the editor will -
 * `div.folio-block[data-type][id]`, the mention labels, the comment label,
 * and a `Page N` divider before each block the record says begins a page -
 * so the first paint is the script and the editor's arrival changes little
 * on screen. Read-only; no handler, no state. It goes away the moment the
 * editor mounts.
 *
 * A page that begins *inside* a block is drawn here at the block's start;
 * the editor places it at the engine's offset once it mounts. One divider
 * moving by a few lines on hydration is the cost of not wrapping text on
 * the server.
 */

const Runs = ({ content, labelFor }: { readonly content: InlineContent; readonly labelFor: LabelFor }) => {
  const out: ReactNode[] = []
  content.forEach((run, index) => {
    if (run.kind === 'text') {
      out.push(<span key={index}>{run.text}</span>)
      return
    }
    out.push(
      <span key={index} className="folio-mention" data-entity={run.target.entity} data-id={run.target.id}>
        {labelFor(run.target.entity, run.target.id) ?? '?'}
      </span>,
    )
  })
  return <>{out}</>
}

const Divider = ({ entry }: { readonly entry: PageBreak }) => (
  <div className="folio-page-break" data-page-break={entry.ordinal} data-page-label={entry.label} data-page-locked={entry.locked ? 'true' : 'false'}>
    {entry.more === null ? null : <span className="folio-page-break-artefact">{entry.more}</span>}
    <span className="folio-page-break-label">Page {entry.label}</span>
    <span className="folio-page-break-rule" />
    {entry.continued === null ? null : <span className="folio-page-break-artefact">{entry.continued}</span>}
  </div>
)

export const StaticSheet = ({
  nodes,
  record,
  paged,
  labelFor,
}: {
  readonly nodes: readonly ScreenplayNode[]
  readonly record: MeasurementRecord | null
  readonly paged: boolean
  readonly labelFor: LabelFor
}) => {
  const breaks = paged ? pageBreaksByNode(pageBreaksOf(record)) : new Map<string, readonly PageBreak[]>()
  return (
    <div className="folio-editable" data-static-sheet="" aria-hidden="true">
      {nodes.map((node) => (
        <div key={node.id} className="contents">
          {(breaks.get(node.id) ?? []).map((entry) => (
            <Divider key={entry.ordinal} entry={entry} />
          ))}
          <div className="folio-block" data-type={node.type} data-static-id={node.id} id={`n-${node.id}`}>
            {node.type === 'comment' ? (
              <div className="folio-comment-label">
                Note<span>not exported</span>
              </div>
            ) : null}
            <Runs content={node.content} labelFor={labelFor} />
          </div>
        </div>
      ))}
    </div>
  )
}
