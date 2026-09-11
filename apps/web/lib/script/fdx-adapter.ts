import type { FdxNode } from '@folio/script'
import { fdxNode } from '@folio/script'
import { XMLParser } from 'fast-xml-parser'

/**
 * The adapter `fdx.ts` says the caller owes: `fast-xml-parser`'s tree to the
 * `FdxNode` contract `@folio/script` owns.
 *
 * The options are the ones written in the `fdx.ts` header, verbatim.
 * `preserveOrder` because a script is an ordered list of nodes and the parser
 * would otherwise group same-named siblings; `trimValues: false` because Final
 * Draft's spacing is the writer's, not ours to normalise. This is the one
 * place `fast-xml-parser` is imported: `packages/script` may not depend on it,
 * and the mapping - the part that is the product - stays pure over there.
 *
 * With `preserveOrder`, the parser returns an array of one-key objects:
 * `{ Paragraph: [...children], ':@': { Type: 'Action' } }` for an element and
 * `{ '#text': '...' }` for character data. That shape is walked here and
 * nowhere else.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  trimValues: false,
  textNodeName: '#text',
})

const ATTRIBUTES_KEY = ':@'
const TEXT_KEY = '#text'

const asAttributes = (value: unknown): Readonly<Record<string, string>> => {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') out[key] = raw
    else if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = String(raw)
  }
  return out
}

/** One parsed entry to zero or one `FdxNode`s; text entries return `null` and are gathered by the parent. */
const toNode = (entry: unknown): FdxNode | { readonly text: string } | null => {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  if (TEXT_KEY in record) {
    const text = record[TEXT_KEY]
    return { text: typeof text === 'string' ? text : String(text) }
  }
  const name = Object.keys(record).find((key) => key !== ATTRIBUTES_KEY)
  if (name === undefined) return null
  const rawChildren = record[name]
  const children: FdxNode[] = []
  let text = ''
  if (Array.isArray(rawChildren)) {
    for (const child of rawChildren) {
      const built = toNode(child)
      if (built === null) continue
      if ('name' in built) children.push(built)
      else text += built.text
    }
  }
  return fdxNode(name, { attributes: asAttributes(record[ATTRIBUTES_KEY]), children, text })
}

/**
 * Parse `.fdx` text into the tree `importFinalDraft` reads. Total: malformed
 * XML yields whatever the parser could read, wrapped in a `#document` root,
 * and the mapping reports what it could not find rather than throwing.
 */
export const readFdx = (xml: string): FdxNode => {
  const parsed: unknown = parser.parse(xml)
  const children: FdxNode[] = []
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const built = toNode(entry)
      if (built !== null && 'name' in built) children.push(built)
    }
  }
  return fdxNode('#document', { children })
}
