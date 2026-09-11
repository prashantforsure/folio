'use client'

import type { MentionEntity } from '@folio/script'
import type { RenderLeafProps } from 'platejs'
import type { PlateElementProps } from 'platejs/react'
import { PlateElement, useSelected } from 'platejs/react'
import { createContext, useContext } from 'react'

import { isOutlineElement } from '../../../../../../../lib/outline/slate-model'
import { isMentionElement } from '../../../../../../../lib/script/slate-model'

/**
 * How each of the seven outline blocks is drawn, and the two inline things.
 *
 * One component renders every block. It reads `element.type` - the union's
 * own discriminant - into `data-type` and `globals.css` does the rhythm and
 * the faces. The gutter ring, the beat's number and the empty last block's
 * ghost line come from `OutlineContext`: the workspace computes them from
 * the value once per change, which for a page of prose is nothing.
 *
 * A `rule` is a void: the line is drawn `contentEditable={false}` and Slate's
 * required empty text sits invisibly beside it, so the caret can land on
 * the block (to delete it, or press Enter under it) without ever being
 * *inside* a line.
 *
 * A beat's bold lead is a decoration, not a mark: `outline-editor.tsx`
 * decorates the range up to the first colon with `beatLead` and `Leaf`
 * draws it 700. Nothing about the lead is stored; `readBeatHeadline` reads
 * the same colon.
 */

export type OutlineContextValue = {
  readonly labelFor: (entity: MentionEntity, id: string) => string | undefined
  /** Beat node id -> its number among the outline's beats. */
  readonly beatOrdinal: ReadonlyMap<string, number>
  readonly caretBlockId: string | null
  /** The last block's id, for the ghost line on an empty one. */
  readonly lastBlockId: string | null
}

export const OutlineContext = createContext<OutlineContextValue>({
  labelFor: () => undefined,
  beatOrdinal: new Map(),
  caretBlockId: null,
  lastBlockId: null,
})

export const useOutline = (): OutlineContextValue => useContext(OutlineContext)

const isEmptyBlock = (element: { readonly children: readonly unknown[] }): boolean =>
  element.children.every((child) => typeof child === 'object' && child !== null && (child as { text?: unknown }).text === '')

export const OutlineBlock = (props: PlateElementProps) => {
  const { element } = props
  const { beatOrdinal, caretBlockId, lastBlockId } = useOutline()
  const selected = useSelected()
  if (!isOutlineElement(element)) {
    // Cannot happen after normalisation; drawn plainly so a stray shape is
    // visible and the strict reader refuses it at save.
    return (
      <PlateElement {...props} className="folio-outline-block" attributes={{ ...props.attributes, 'data-type': 'unknown' }}>
        {props.children}
      </PlateElement>
    )
  }
  const isCaret = caretBlockId === element.id
  const attributes = {
    ...props.attributes,
    'data-type': element.type,
    'data-node-id': element.id,
    'data-selected': selected ? 'true' : 'false',
  }

  if (element.type === 'rule') {
    return (
      <PlateElement {...props} className="folio-outline-block" attributes={attributes}>
        <span className="folio-prose-dot" data-caret={isCaret ? 'true' : 'false'} contentEditable={false} />
        <span className="folio-outline-rule" contentEditable={false} />
        <span className="absolute left-0 top-0 h-0 w-0 overflow-hidden">{props.children}</span>
      </PlateElement>
    )
  }

  const ghost =
    element.type === 'body' && lastBlockId === element.id && isEmptyBlock(element) ? (
      <span className="folio-outline-ghost" contentEditable={false}>
        Type, or press <b>/</b> for a block<i>|</i>
      </span>
    ) : null

  if (element.type === 'quote') {
    return (
      <PlateElement {...props} className="folio-outline-block" attributes={attributes}>
        <span className="folio-prose-dot" data-caret={isCaret ? 'true' : 'false'} contentEditable={false} />
        <div className="folio-outline-quote">{props.children}</div>
      </PlateElement>
    )
  }

  return (
    <PlateElement {...props} className="folio-outline-block" attributes={attributes}>
      <span className="folio-prose-dot" data-caret={isCaret ? 'true' : 'false'} contentEditable={false} />
      {element.type === 'beat' ? (
        <span className="folio-outline-marker" contentEditable={false}>
          {beatOrdinal.get(element.id) ?? '·'}
        </span>
      ) : null}
      {ghost}
      {props.children}
    </PlateElement>
  )
}

/** An `@mention` in the outline: an inline void drawing its record's current name. */
export const OutlineMention = (props: PlateElementProps) => {
  const { element } = props
  const { labelFor } = useOutline()
  const selected = useSelected()
  const label = isMentionElement(element) ? (labelFor(element.entity, element.id) ?? '?') : '?'
  return (
    <PlateElement
      {...props}
      as="span"
      className="folio-mention"
      attributes={{ ...props.attributes, 'data-selected': selected ? 'true' : 'false', contentEditable: false }}
    >
      {label}
      {props.children}
    </PlateElement>
  )
}

export type OutlineDecoration = { readonly beatLead?: true }

/** A leaf. Plain, or the bold lead of a beat up to its colon. */
export const OutlineLeaf = (props: RenderLeafProps) => {
  const { attributes, children, leaf } = props
  const decoration = leaf as OutlineDecoration
  return (
    <span {...attributes} className={decoration.beatLead === true ? 'folio-outline-lead' : undefined}>
      {children}
    </span>
  )
}
