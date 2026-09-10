/**
 * @folio/contracts — Zod schemas shared by web and worker.
 *
 * Deliberately empty. Types flow out of here; nothing downstream redeclares a
 * shape. Schemas are named `XSchema` with `type X = z.infer<typeof XSchema>`.
 */
export const PACKAGE_NAME = '@folio/contracts'
