import type { InlineContent, MeasurementRecord, ScreenplayNode, SheetSpec } from '@folio/script'
import type { ReactNode } from 'react'

import type { LabelFor, ScriptInline } from '../../../../../../../lib/script/inline'
import { MENTION_TYPE, isMentionElement } from '../../../../../../../lib/script/inline'
import { charsPerLineFor, layoutSheet } from '../../../../../../../lib/script/layout'
import type { SheetLayout } from '../../../../../../../lib/script/layout'
import { lineCountOf, lineEndsOf } from '../../../../../../../lib/script/lines'

/**
 * The sheet before the editor exists: the same blocks, at the same
 * geometry, as plain HTML.
 *
 * Tiptap is created after hydration (`immediatelyRender: false`), so the
 * server would otherwise send an empty desk and a hundred-page draft would
 * paint blank. This renders the node list the way the editor will - the
 * `div.folio-block[data-type]` DOM, the engine's line ends, the margins
 * from the measurement record - so the first paint is the script and the
 * editor's arrival changes nothing on screen. Read-only; no handler, no
 * state. It goes away the moment the editor mounts.
 */

const inlineOf = (content: InlineContent): readonly ScriptInline[] =>
  content.map((run) => (run.kind === 'text' ? { text: run.text } : { type: MENTION_TYPE, entity: run.target.entity, id: run.target.id }))

export const staticLayout = (
  nodes: readonly ScreenplayNode[],
  record: MeasurementRecord | null,
  sheet: SheetSpec,
  paged: boolean,
  labelFor: LabelFor,
): SheetLayout =>
  layoutSheet(
    nodes.map((node) => ({
      id: node.id,
      type: node.type,
      lines: lineCountOf(lineEndsOf(inlineOf(node.content), labelFor, charsPerLineFor(sheet, node.type))),
    })),
    record,
    sheet,
    paged,
  )

/** A block's children with the engine's line ends drawn as `.folio-line-end` on the last character of each line. */
const Children = ({ children, labelFor, charsPerLine }: { readonly children: readonly ScriptInline[]; readonly labelFor: LabelFor; readonly charsPerLine: number }) => {
  const ends = lineEndsOf(children, labelFor, charsPerLine)
  const out: ReactNode[] = []
  children.forEach((child, index) => {
    if (isMentionElement(child)) {
      out.push(
        <span key={index} className="folio-mention" data-entity={child.entity} data-id={child.id}>
          {labelFor(child.entity, child.id) ?? '?'}
        </span>,
      )
      return
    }
    const breaks = ends.filter((end) => end.child === index).map((end) => end.offset)
    let at = 0
    breaks.forEach((offset, which) => {
      if (offset - 1 > at) out.push(<span key={`${String(index)}:${String(which)}:t`}>{child.text.slice(at, offset - 1)}</span>)
      out.push(
        <span key={`${String(index)}:${String(which)}:e`} className="folio-line-end">
          {child.text.slice(Math.max(at, offset - 1), offset)}
        </span>,
      )
      at = offset
    })
    if (at < child.text.length) out.push(<span key={`${String(index)}:rest`}>{child.text.slice(at)}</span>)
  })
  return <>{out}</>
}

export const StaticSheet = ({
  nodes,
  layout,
  sheet,
  labelFor,
}: {
  readonly nodes: readonly ScreenplayNode[]
  readonly layout: SheetLayout
  readonly sheet: SheetSpec
  readonly labelFor: LabelFor
}) => (
  <div className="folio-editable" data-static-sheet="" aria-hidden="true">
    {nodes.map((node) => {
      const placed = layout.blocks.get(node.id)
      return (
        <div
          key={node.id}
          className="folio-block"
          data-type={node.type}
          data-static-id={node.id}
          data-measured={placed?.measured === true ? 'true' : 'false'}
          style={{ marginTop: placed?.marginTopPx ?? 0 }}
        >
          {node.type === 'comment' ? (
            <div className="folio-comment-label">
              Comment<span>not exported · not paginated</span>
            </div>
          ) : null}
          <Children children={inlineOf(node.content)} labelFor={labelFor} charsPerLine={charsPerLineFor(sheet, node.type)} />
        </div>
      )
    })}
  </div>
)
