import type { FdxNode } from '../fdx'

/**
 * A minimal XML reader, for the test corpus only.
 *
 * The shipped path is the one in the `fdx.ts` header: `fast-xml-parser` runs in
 * `apps/web` and `apps/worker`, and the caller hands `importFinalDraft` an
 * `FdxNode` tree. This exists so the corpus in `fdx-corpus.ts` can be **real
 * `.fdx` text** that a reviewer can read, rather than hand-built trees that
 * would prove the mapping works on trees the test itself invented.
 *
 * It is not a general XML parser and must never become one. No namespaces, no
 * DTDs, no CDATA, no entity declarations - a Final Draft file needs none of
 * them, and the moment this file needs any of them it has stopped being test
 * support. `packages/script` may not import `node:fs` (the purity boundary in
 * `eslint.config.mjs` is an error, and the test override relaxes globals, not
 * imports), which is also why the corpus is a string rather than a file.
 *
 * The contract under test is `FdxNode`, not this reader: the adapter in
 * `apps/*` owes the same shape, and the doc comment in `fdx.ts` gives it the
 * exact `fast-xml-parser` options that produce it.
 */

type Builder = {
  name: string
  attributes: Record<string, string>
  children: Builder[]
  text: string
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

const decode = (raw: string): string =>
  raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return ENTITIES[body] ?? whole
  })

const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/gu

const readAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {}
  const pattern = new RegExp(ATTRIBUTE.source, 'gu')
  for (;;) {
    const match = pattern.exec(source)
    if (match === null) break
    const name = match[1]
    const value = match[3] ?? match[4]
    if (name === undefined || value === undefined) continue
    attributes[name] = decode(value)
  }
  return attributes
}

const freeze = (builder: Builder): FdxNode => ({
  name: builder.name,
  attributes: builder.attributes,
  children: builder.children.map(freeze),
  text: builder.text,
})

/**
 * Read XML into the tree the mapping consumes.
 *
 * Total: unbalanced or truncated input yields whatever was read, because a test
 * helper that throws halfway through a corpus tells you less than one that
 * hands back a short tree and lets the assertion say what is missing.
 */
export const readFdxXml = (xml: string): FdxNode => {
  const root: Builder = { name: '#document', attributes: {}, children: [], text: '' }
  const stack: Builder[] = [root]
  const current = (): Builder => stack[stack.length - 1] ?? root

  let index = 0
  while (index < xml.length) {
    const open = xml.indexOf('<', index)
    if (open === -1) {
      current().text += decode(xml.slice(index))
      break
    }
    if (open > index) current().text += decode(xml.slice(index, open))

    // <?xml ... ?> and <!-- ... --> / <!DOCTYPE ...>: skipped whole.
    if (xml.startsWith('<?', open) || xml.startsWith('<!', open)) {
      const close = xml.indexOf('>', open)
      index = close === -1 ? xml.length : close + 1
      continue
    }

    const close = xml.indexOf('>', open)
    if (close === -1) break
    const inner = xml.slice(open + 1, close)

    if (inner.startsWith('/')) {
      if (stack.length > 1) stack.pop()
      index = close + 1
      continue
    }

    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1) : inner
    const space = body.search(/\s/u)
    const name = space === -1 ? body : body.slice(0, space)
    const element: Builder = {
      name,
      attributes: space === -1 ? {} : readAttributes(body.slice(space)),
      children: [],
      text: '',
    }
    current().children.push(element)
    if (!selfClosing) stack.push(element)
    index = close + 1
  }

  return freeze(root)
}
