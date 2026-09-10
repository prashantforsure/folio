/**
 * Type-level equality, and the assertion that uses it.
 *
 * AGENTS.md, Conventions > Typing: "Types flow out of `packages/contracts`; do
 * not redeclare a shape downstream." That is a rule about human behaviour until
 * something checks it. This file is what checks it.
 *
 * Several shapes in this package are *already* declared, precisely, in
 * `@folio/script` - `ScreenplayNode`, `DerivedEntities`, `MeasurementRecord`.
 * A Zod schema for one of those is a second declaration of the same shape, and
 * a second declaration is exactly the bug this package exists to prevent. So
 * every such schema is followed by `assertExact<Equals<z.infer<typeof S>, T>>()`,
 * which stops compiling the moment the two drift apart in either direction.
 *
 * `Equals` is the conditional-type identity trick: two types are the same only
 * if the two deferred conditionals are assignable both ways. Unlike
 * `A extends B ? B extends A : false` it does not distribute over unions and it
 * distinguishes `any`, so `Equals<any, string>` is `false` rather than `true`.
 *
 * `pnpm typecheck` is a test suite here for the same reason it is in
 * `packages/script` - see `type-guarantees.test.ts` there.
 */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/**
 * Compiles only when its argument is `true`.
 *
 * Takes no runtime argument: the whole assertion is the type parameter, so the
 * call costs nothing at runtime and cannot be satisfied by a value.
 */
export const assertExact = <_Check extends true>(): void => {}

/** `Equals`, but only requiring that `A` is assignable to `B`. */
export type Extends<A, B> = [A] extends [B] ? true : false
