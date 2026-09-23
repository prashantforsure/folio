/**
 * What `next/*` resolves to inside the worker's bundle (`scripts/build.mjs`).
 *
 * The worker runs web's domain code (`apps/web/lib/worker/`) outside any Next
 * request, and a request API called there - `cookies()`, `revalidatePath()`,
 * `after()` - is a bug: there is no cookie, no cache to revalidate, no response
 * to run after. `tests/worker-import-graph.test.ts` in web keeps the handlers'
 * import graph clear of Next altogether; this is the net under that test, so
 * that if a path to Next ever opens, calling it fails loudly with its name
 * rather than quietly doing something a request would have done.
 */
const refuse = (name: string) => (): never => {
  throw new Error(`Folio: ${name}() is a Next.js request API; the worker has no request.`)
}

export const after = refuse('after')
export const cookies = refuse('cookies')
export const headers = refuse('headers')
export const notFound = refuse('notFound')
export const redirect = refuse('redirect')
export const revalidatePath = refuse('revalidatePath')
export const revalidateTag = refuse('revalidateTag')
