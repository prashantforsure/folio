'use client'

import type { ScreenplayNodeType } from '@folio/script'
import type { RenderLeafProps } from 'platejs'
import type { PlateElementProps } from 'platejs/react'
import { PlateElement, useSelected } from 'platejs/react'

import { isMentionElement, isScriptElement } from '../../../../../../../lib/script/slate-model'
import { useSheet } from './layout-context'

/**
 * How each of the eight types is drawn, and the two inline things.
 *
 * One component renders every block. It reads `element.type` - which is the
 * union's own discriminant (`slate-model.ts`) - into `data-type`, and the
 * CSS in `globals.css` does the insets. `TYPE_LABEL` is a `Record` over the
 * union so a ninth type is a compile error here before it is a wrong inset.
 *
 * The block's vertical position comes from `SheetContext`: `marginTop` from
 * the measurement record, never from the DOM. A split block also draws its
 * page gap, but not here - the gap sits *between two of its lines*, so it is
 * a decoration on the leaf that ends the first page (see `Leaf` below and
 * `plate-editor.tsx`'s `decorate`).
 */

export const TYPE_LABEL: Readonly<Record<ScreenplayNodeType, string>> = {
  scene: 'Scene',
  action: 'Action',
  character: 'Character',
  paren: 'Paren',
  dialogue: 'Dialogue',
  transition: 'Transition',
  comment: 'Comment',
  subtitle: 'Subtitle',
}

export const ScriptBlock = (props: PlateElementProps) => {
  const { element } = props
  const { layout, caretBlockId } = useSheet()
  if (!isScriptElement(element)) {
    // Cannot happen after normalisation; drawn plainly rather than hidden so
    // a stray shape is visible and the strict reader refuses it at save.
    return (
      <PlateElement {...props} className="folio-block" attributes={{ ...props.attributes, 'data-type': 'unknown' }}>
        {props.children}
      </PlateElement>
    )
  }
  const placed = layout.blocks.get(element.id)
  const isCaret = caretBlockId === element.id
  const style = { marginTop: placed?.marginTopPx ?? 0 }

  return (
    <PlateElement
      {...props}
      className="folio-block"
      style={style}
      attributes={{
        ...props.attributes,
        'data-type': element.type,
        'data-node-id': element.id,
        'data-measured': placed?.measured === true ? 'true' : 'false',
      }}
    >
      {element.type === 'comment' ? (
        <div className="folio-comment-label" contentEditable={false}>
          Comment<span>not exported · not paginated</span>
        </div>
      ) : null}
      {isCaret && element.type !== 'comment' ? (
        <span className="folio-chip" contentEditable={false}>
          {TYPE_LABEL[element.type]}
        </span>
      ) : null}
      {props.children}
    </PlateElement>
  )
}

/** An `@mention`: an inline void that draws its record's current name. */
export const MentionInline = (props: PlateElementProps) => {
  const { element } = props
  const { labelFor } = useSheet()
  const selected = useSelected()
  const label = isMentionElement(element) ? (labelFor(element.entity, element.id) ?? '?') : '?'
  return (
    <PlateElement
      {...props}
      as="span"
      className="folio-mention"
      attributes={{
        ...props.attributes,
        'data-selected': selected ? 'true' : 'false',
        contentEditable: false,
      }}
    >
      {label}
      {props.children}
    </PlateElement>
  )
}

/** What `decorate` puts on a text range. */
export type LineDecoration = {
  readonly lineEnd?: true
  readonly pageGap?: {
    readonly heightPx: number
    readonly more: string | null
    readonly continued: string | null
    /** Offset from the block's left inset to the cue's, so the continued cue sits at the cue indent. */
    readonly cueOffsetPx: number
    readonly moreOffsetPx: number
  }
}

/**
 * A leaf. Plain text, or the last text of an engine line, or the last text
 * before a page break inside a split block - in which case the gap, `(MORE)`
 * and the continued cue are drawn after it as a non-editable block box.
 */
export const Leaf = (props: RenderLeafProps) => {
  const { attributes, children, leaf } = props
  const decoration = leaf as LineDecoration
  const gap = decoration.pageGap
  return (
    <span {...attributes} className={decoration.lineEnd === true && gap === undefined ? 'folio-line-end' : undefined}>
      {children}
      {gap === undefined ? null : (
        <span className="folio-page-gap" contentEditable={false} style={{ height: gap.heightPx }}>
          {gap.more === null ? null : (
            <span className="folio-page-gap-more" style={{ left: gap.moreOffsetPx }}>
              {gap.more}
            </span>
          )}
          {gap.continued === null ? null : (
            <span className="folio-page-gap-continued" style={{ left: gap.cueOffsetPx }}>
              {gap.continued}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
