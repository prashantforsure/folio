import {
  isErr,
  readInlineContent,
  readOutlineDocument,
  readOutlineNode,
  readScreenplayDocument,
  readScreenplayNode,
} from '@folio/script'
import type {
  InlineContent,
  ModelDefect,
  OutlineDocument,
  OutlineNode,
  Result,
  ScreenplayDocument,
  ScreenplayNode,
} from '@folio/script'
import { z } from 'zod'

import { assertExact } from './equality'
import type { Equals } from './equality'

/**
 * The node model at the boundary.
 *
 * **These schemas do not validate anything themselves.** Every one of them
 * delegates to the reader `@folio/script` already owns - `readScreenplayNode`,
 * `readOutlineNode` and the two document readers - and does nothing but turn a
 * `Result` into a Zod issue.
 *
 * That indirection is the entire point. `read.ts` is strict in a way a Zod
 * object cannot casually be: it rejects unrecognised fields, and it rejects the
 * five `PAGINATION_FIELDS` by name, so a page number cannot ride in on a node
 * over the wire. AGENTS.md, The node model: "**There is no `page` attribute on
 * a node. Ever.**" That ban is "enforced twice from one `PAGINATION_FIELDS`
 * tuple" (CLAUDE.md) - `page?: never` at compile time and rejection at the wire
 * in `read.ts`. A hand-written `z.object({ id, type, content, provenance })`
 * here would be a **third** enforcement point that knew about neither, and the
 * first time someone added a node field it would be the one that silently
 * disagreed.
 *
 * So the rule this file follows: **`packages/contracts` owns the shapes the
 * database and the wire invent, and borrows every shape the pure core already
 * declares.** Anything else is the redeclaration this package exists to stop.
 */

/**
 * Turn a `Result` from the pure core into a Zod refinement.
 *
 * `z.custom` with a `superRefine` rather than `z.unknown().transform()`: the
 * transform form cannot fail without throwing, and the reader's whole
 * contract is that it does not throw.
 */
const fromReader = <T>(
  read: (input: unknown) => Result<T, ModelDefect>,
  label: string,
): z.ZodType<T, unknown> =>
  z.custom<T>().superRefine((input, ctx) => {
    const result = read(input)
    if (isErr(result)) {
      const defect = result.error
      ctx.addIssue({
        code: 'custom',
        message: `${label}: ${describeDefect(defect)}`,
        path: defect.at === '' ? [] : defect.at.split('.'),
        params: { defect },
      })
    }
  })

/**
 * A `ModelDefect` in one line.
 *
 * The structured defect is carried through on `params` so a caller that wants
 * to render it properly still can; this is the human-readable fallback, and it
 * says what was wrong rather than "Invalid input".
 */
const describeDefect = (defect: ModelDefect): string => {
  const where = defect.at === '' ? '' : ` at ${defect.at}`
  const reason = defect.reason
  switch (reason.kind) {
    case 'not-an-object':
      return `expected an object${where}, received ${reason.received}`
    case 'not-an-array':
      return `expected an array${where}, received ${reason.received}`
    case 'not-a-string':
      return `expected a string${where}, received ${reason.received}`
    case 'missing-field':
      return `missing field ${reason.field}${where}`
    case 'unexpected-field':
      return `unexpected field ${reason.field}${where}`
    case 'pagination-on-node':
      return `a node may not carry ${reason.field}${where} - pagination lives on a measurement record`
    case 'empty-id':
      return `empty id${where}`
    case 'duplicate-node-id':
      return `duplicate node id ${reason.id}${where}`
    case 'unknown-value':
      return `unknown value ${reason.received}${where} - expected one of ${reason.allowed.join(', ')}`
  }
}

export const ScreenplayNodeSchema = fromReader(readScreenplayNode, 'screenplay node')
export const OutlineNodeSchema = fromReader(readOutlineNode, 'outline block')
export const ScreenplayDocumentSchema = fromReader(readScreenplayDocument, 'screenplay document')
export const OutlineDocumentSchema = fromReader(readOutlineDocument, 'outline document')

assertExact<Equals<z.infer<typeof ScreenplayNodeSchema>, ScreenplayNode>>()
assertExact<Equals<z.infer<typeof OutlineNodeSchema>, OutlineNode>>()
assertExact<Equals<z.infer<typeof ScreenplayDocumentSchema>, ScreenplayDocument>>()
assertExact<Equals<z.infer<typeof OutlineDocumentSchema>, OutlineDocument>>()

/**
 * Inline content on its own - a storyboard shot's description, which
 * carries `@mentions` the way an action line does and is held to the same
 * reader. Not a node: it has no id, no type and no provenance of its own.
 */
export const InlineContentSchema = fromReader(readInlineContent, 'inline content')

assertExact<Equals<z.infer<typeof InlineContentSchema>, InlineContent>>()

/**
 * A document of either kind, discriminated by `kind`.
 *
 * AGENTS.md, The node model: the Outline is "a **different document kind in
 * the same table** with a different, tiny, closed block set". One union at the
 * boundary, one table underneath, and no type at which a `ScreenplayNode` and
 * an `OutlineNode` are interchangeable - which is what stops an `h2` reaching a
 * screenplay.
 *
 * `z.union` and not `z.discriminatedUnion`, because the two members are
 * `z.custom` refinements rather than object schemas and Zod cannot read a
 * discriminator key off them. The discrimination is real regardless: each
 * reader checks `kind` itself and rejects the other value.
 */
export const FolioDocumentSchema = z.union([ScreenplayDocumentSchema, OutlineDocumentSchema])

assertExact<
  Equals<z.infer<typeof FolioDocumentSchema>, ScreenplayDocument | OutlineDocument>
>()
