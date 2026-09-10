import { z } from 'zod'

/**
 * Small shared primitives.
 *
 * ## Why timestamps are strings and not `Date`
 *
 * AGENTS.md, Validation: schemas here are "shared by web and worker". A worker
 * reads a row over a queue payload and a Server Component serialises one to the
 * client; a `Date` survives neither trip without a codec, and the two ends
 * would each invent their own. An ISO-8601 string with an offset survives both
 * unchanged, and it is what makes these **boundary** contracts rather than a
 * mirror of the database. `packages/db` stores `timestamptz` and its
 * repositories are the one place the two representations meet.
 */

/** ISO-8601 with an offset. `2026-09-11T00:31:00.000Z`. */
export const TimestampSchema = z.iso.datetime({ offset: true })

export type Timestamp = z.infer<typeof TimestampSchema>

export const toTimestamp = (value: Date): Timestamp => value.toISOString()

/**
 * Free text a person typed, trimmed, with a length that will not blow a row up.
 *
 * 200 is a title, not a paragraph; the longer fields say so explicitly.
 */
export const TitleSchema = z.string().trim().min(1).max(200)

/**
 * A fractional order key.
 *
 * The design bundle's Appendix A sketches node ordering as
 * `order: number  // fractional index, so insert never renumbers`. A float is
 * the wrong carrier for that idea: repeatedly inserting between two adjacent
 * nodes halves the gap each time, and IEEE-754 runs out of mantissa after
 * roughly fifty splits at the same point - which a writer breaking the same
 * paragraph over and over will reach. The failure is silent and it corrupts
 * document order, which is the one thing AGENTS.md says the script is.
 *
 * So the key is a **lexicographically ordered string**: compare with `<`, and
 * a midpoint between any two distinct keys always exists because the string can
 * always get one character longer. This is the standard fractional-index shape.
 * `packages/db` owns the generator; this is the wire type.
 *
 * **Flagged as a deviation from Appendix A**, which says `number`. The appendix
 * is a sketch and its own preamble says the contract wins where the two differ,
 * but nobody has ruled this one specifically.
 */
export const OrderKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[0-9A-Za-z]+$/, 'An order key is base-62, compared as a string.')

export type OrderKey = z.infer<typeof OrderKeySchema>

/**
 * Authored data no package interprets.
 *
 * The same shape as `AuthoredNotes` in `@folio/script`, and deliberately not
 * imported from it: that type is what the pure core promises **not to touch**
 * during a re-derive, and this is what the wire promises to carry unchanged.
 * They are the same JSON, reached for different reasons. The `assertExact` in
 * `derived.ts` holds them together.
 */
export const AuthoredValueSchema: z.ZodType<AuthoredValueLike> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(AuthoredValueSchema),
    z.record(z.string(), AuthoredValueSchema),
  ]),
)

type AuthoredValueLike =
  | string
  | number
  | boolean
  | null
  | readonly AuthoredValueLike[]
  | { readonly [key: string]: AuthoredValueLike }

export const AuthoredNotesSchema = z.record(z.string(), AuthoredValueSchema)

/**
 * A count of credits.
 *
 * An integer, and signed, because a ledger entry is a delta and half of them
 * are negative. Never a balance - AGENTS.md, exception table: "Compute from the
 * append-only ledger. Never store a balance."
 */
export const CreditDeltaSchema = z.int()

/** Where a paginated read left off. Opaque to the caller. */
export const CursorSchema = z.string().min(1).max(512)

export const PageRequestSchema = z.object({
  limit: z.int().min(1).max(200).default(50),
  cursor: CursorSchema.optional(),
})

export type PageRequest = z.infer<typeof PageRequestSchema>
