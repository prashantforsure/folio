import { ASSISTANT_MESSAGE_MAX, ProjectIdSchema, ProjectTypeSchema, ScriptFormatSchema, TitleSchema } from '@folio/contracts'
import { transactionDatabase } from '@folio/db'
import { z } from 'zod'

import { readProjectList } from '../../projects/server'
import { PROJECT_FILTERS, PROJECT_SORTS, kindLine, statsLine } from '../../projects/view'
import { defineTool } from '../registry'
import type { Tool } from '../registry'

/**
 * The launcher's toolset - `docs/agents/tools.md`, *Launcher - outside a
 * project*, and ADR 0003 **D15**. Minimum role `user`: any signed-in person,
 * because outside a project there is no membership to have a role in
 * (`minimumRole: null` here). What either tool reads is the caller's own
 * memberships and nothing else.
 *
 * **No model turn calls these yet** (ruled 2026-09-23); `start_story_project`
 * joined them in roadmap task 3.6, and its button in the launcher is live: a launcher turn has no
 * project for `agent_runs` to record it on, and the D3 meter and D14 limits
 * are per project. The launcher panel reads the same list through
 * `listRecentProjects`, and a click is its `open_project`. The tools are
 * registered and tested so that on the day that is ruled, only the turn is new.
 */

export const listProjects = defineTool({
  name: 'list_projects',
  description:
    "List the writer's projects the way the Projects page does - all of them, only screenplays or filmmaking, those shared with them, or the archived - with each filter's count.",
  toolset: 'launcher',
  minimumRole: null,
  mode: 'read',
  input: z.object({ filter: z.enum(PROJECT_FILTERS).default('all'), sort: z.enum(PROJECT_SORTS).default('recent') }),
  label: () => 'Reading your projects',
  run: async (ctx, input) => {
    const list = await readProjectList(await transactionDatabase(), ctx.gate.actor, input.filter, input.sort)
    return {
      ok: true,
      content: {
        counts: list.counts,
        projects: list.cards.map((card) => ({ id: card.project.id, title: card.project.title, kind: kindLine(card), stats: statsLine(card), archived: card.project.archivedAt !== null })),
      },
      summary: `${String(list.cards.length)} ${list.cards.length === 1 ? 'project' : 'projects'}`,
    }
  },
})

export const openProject = defineTool({
  name: 'open_project',
  description: "Open one of the writer's projects, by its id from list_projects. The panel takes them there.",
  toolset: 'launcher',
  minimumRole: null,
  mode: 'client',
  input: z.object({ projectId: ProjectIdSchema }),
  label: () => 'Opening a project',
  run: async (ctx, input) => {
    // Only a project the caller is a member of, live or archived: the list is the membership check.
    const db = await transactionDatabase()
    const [live, archived] = await Promise.all([
      readProjectList(db, ctx.gate.actor, 'all', 'recent'),
      readProjectList(db, ctx.gate.actor, 'archived', 'recent'),
    ])
    const card = [...live.cards, ...archived.cards].find((entry) => entry.project.id === input.projectId)
    if (card === undefined) return { ok: false, message: 'That project could not be found.' }
    ctx.emit({ type: 'navigate', target: { kind: 'project', projectId: card.project.id } })
    return { ok: true, content: { opened: card.project.title }, summary: `Opened ${card.project.title}` }
  },
})

/**
 * `start_story_project` - **confirm** (roadmap task 3.6, ADR 0003 D15). A new
 * project from a story, created only after the writer says yes, with the chat
 * continuing inside it. Outside a project there is no proposal to write - a
 * proposal row needs a project - so the confirmation is the launcher's own
 * step and the creation is `startStoryProject`, called by that step. This tool
 * never creates anything: it asks (`confirm_required`) and says so. A model
 * cannot confirm on the writer's behalf.
 */
export const startStoryProject = defineTool({
  name: 'start_story_project',
  description:
    'Offer to start a new screenwriting project from a story the writer has given you: a title, film or series, and the story. The writer confirms it in the launcher; nothing is created until they do.',
  toolset: 'launcher',
  minimumRole: null,
  mode: 'confirm',
  input: z.object({ title: TitleSchema, projectType: ProjectTypeSchema, format: ScriptFormatSchema.default('hollywood'), story: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX) }),
  label: (input) => `Offering to start ${input.title}`,
  run: (ctx, input) => {
    const summary = `Create ${input.title}, a ${input.projectType}, and continue there with the story`
    ctx.emit({ type: 'confirm_required', id: ctx.idempotencyKey, name: 'start_story_project', summary, cost: null })
    return Promise.resolve({ ok: true, content: { awaiting: summary, status: 'The writer confirms this in the launcher; nothing has been created.' }, summary: 'Waiting for the writer to confirm' })
  },
})

export const LAUNCHER_TOOLS: readonly Tool[] = [listProjects, openProject, startStoryProject]
