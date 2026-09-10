import type { EpisodeSlug, ProjectId, UserId } from '@folio/contracts'

import type { FolioDatabase } from './client'
import { readEpisodeBySlug, readProject } from './repositories'
import { scoped } from './scope'
import type { ProjectScope, ProjectScopedTable } from './scope'
import { nodes, users } from './schema'

/**
 * Compile-time proof that an unscoped query does not compile.
 *
 * Every `@ts-expect-error` below is an assertion: the line under it **must**
 * fail to typecheck, and if it ever starts compiling, `tsc` reports the unused
 * directive and the build fails. So a regression in the tenancy machinery is a
 * failed `pnpm typecheck`, not a code review that somebody was having a bad day
 * for.
 *
 * This is the idiom `packages/script` already uses - see
 * `type-guarantees.test.ts` there, and CLAUDE.md: "**`pnpm typecheck` is also a
 * test suite.** ... A typecheck failure there is the guarantee working; fix the
 * model, not the directive."
 *
 * The file is not imported by anything. It exists to be compiled.
 */

// ---------------------------------------------------------------------------
// 1. A repository call without its scope does not compile
// ---------------------------------------------------------------------------

export const missingScopeDoesNotCompile = (): void => {
  // @ts-expect-error - a repository read without a project scope. This is the
  // headline guarantee: there is no argument list that reaches the database
  // without naming which project it is for.
  void readProject()

  // @ts-expect-error - same for a scoped read that takes further arguments.
  void readEpisodeBySlug('ep_001' as EpisodeSlug)
}

// ---------------------------------------------------------------------------
// 2. A scope cannot be fabricated
// ---------------------------------------------------------------------------

export const forgedScopeDoesNotCompile = (
  db: FolioDatabase,
  projectId: ProjectId,
  actor: UserId,
): void => {
  // A hand-built object with the right *visible* fields is still not a scope:
  // `ProjectScope` is keyed by a `unique symbol` that this file cannot name, so
  // there is no literal anywhere in the repository that satisfies it.
  const pretender = { projectId, actor, pooler: 'transaction' as const }

  // @ts-expect-error - looks like a scope, is not one.
  void readProject(pretender)

  // Nor does adding the handle help, because the handle's key is also a symbol
  // this file has no name for.
  const withDatabase = { projectId, actor, pooler: 'transaction' as const, db }

  // @ts-expect-error - still not a scope.
  void readProject(withDatabase)
}

// ---------------------------------------------------------------------------
// 3. A table with no project_id cannot be queried through a scope
// ---------------------------------------------------------------------------

export const unscopedTableDoesNotCompile = (scope: ProjectScope): void => {
  // `nodes` carries `project_id`, so this is fine.
  void scoped(scope, nodes)

  // @ts-expect-error - `users` has no `project_id`, deliberately: a person
  // exists before they belong to a project. It is therefore not a
  // `ProjectScopedTable`, so the one genuine exception to "every table carries
  // project_id" is enforced by the compiler rather than remembered.
  void scoped(scope, users)
}

/** The same fact stated as an assignability check rather than a call. */
export type UsersIsNotProjectScoped = typeof users extends ProjectScopedTable ? never : true

/** ... and its converse, so the test above cannot pass by the type being empty. */
export type NodesIsProjectScoped = typeof nodes extends ProjectScopedTable ? true : never

const usersIsNotScoped: UsersIsNotProjectScoped = true
const nodesIsScoped: NodesIsProjectScoped = true
void usersIsNotScoped
void nodesIsScoped

// ---------------------------------------------------------------------------
// 4. A session-only repository cannot take a request-path scope
// ---------------------------------------------------------------------------

/**
 * Nothing needs this yet - it is here because the moment something does (an
 * advisory lock around a long generation, a `LISTEN`), the requirement should
 * be in the signature rather than discovered in the worker at three in the
 * morning.
 */
const needsASession = (scope: ProjectScope<'session'>): ProjectId => scope.projectId

export const wrongPoolerDoesNotCompile = (request: ProjectScope<'transaction'>): void => {
  // @ts-expect-error - a transaction-pooler scope cannot satisfy a function
  // that needs a session. Supabase's transaction mode hands out a different
  // backend per transaction, so a lock taken on one is not held on the next.
  void needsASession(request)
}
