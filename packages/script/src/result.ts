/**
 * The return shape for every fallible function in this package.
 *
 * AGENTS.md, Conventions > Errors: "Pure functions in `packages/script` do not
 * throw for expected conditions - a malformed heading is *data*, not an
 * exception, and it must be representable in the return type."
 *
 * Nothing in this package throws. If a function can fail, it says so here.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } =>
  result.ok

export const isErr = <T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } =>
  !result.ok
