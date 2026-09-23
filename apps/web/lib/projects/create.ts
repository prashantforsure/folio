import type { CreateProjectInput, Episode, Project, UserId } from '@folio/contracts'
import { createProjectFor, transactionDatabase } from '@folio/db'

import { workspaceHref } from './workspace'

/**
 * Making a project - the step `createProject` (the New dialog's form action)
 * and `startStoryProject` (the launcher's "Start from a story", roadmap task
 * 3.6) share, so there is one path: the project row, the creator's owner
 * membership and the first episode, in one transaction (`createProjectFor`),
 * and the URL of its front door.
 *
 * Not a server action: the caller has already identified the person
 * (`requireUser`), and it is the caller that decides whether to redirect (the
 * form) or hand the project back (the launcher, which then continues the chat
 * inside it - ADR 0003 D15).
 */
export const makeProject = async (
  userId: UserId,
  input: CreateProjectInput,
): Promise<{ readonly project: Project; readonly episode: Episode; readonly href: ReturnType<typeof workspaceHref> }> => {
  const db = await transactionDatabase()
  const { project, episode } = await createProjectFor(db, userId, input)
  return { project, episode, href: workspaceHref(project, episode.slug) }
}
