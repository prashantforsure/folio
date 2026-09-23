import type { TitlePage } from '@folio/contracts'
import { NodeIdSchema, OutlineOpInputSchema, ScriptFormatSchema, ScriptOpInputSchema, TITLE_PAGE_FIELDS, ThreadIdSchema } from '@folio/contracts'
import { readProject, readTitlePage } from '@folio/db'
import type { OutlineOp, ScriptOp } from '@folio/script'
import { insertedIds } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { openThreadOnNode, replyThread, resolveThread, saveTitlePage, setFormat, setPagination } from '../../script/actions'
import { PAGINATION_CONTROLS } from '../../state/project-preferences'
import type { PaginationControl } from '../../state/project-preferences'
import { describeEdit, episodeNumbered, prepareOutlineEdit, prepareScriptEdit } from '../document-ops'
import type { ExecOutcome } from '../executors'
import type { Tool, ToolContext } from '../registry'
import { defineTool } from '../registry'
import type { WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * The Script and Outline write tools - `docs/agents/tools.md`, *Script and
 * outline*, the Phase 3 rows, roadmap task 3.6.
 *
 * `propose_script_edit` and `propose_outline_edit` are the two that write the
 * node list. Their executors are `document-ops.ts`'s (path A through the open
 * editor, path B under the compare-and-swap, task 3.4); what the tools add is
 * the step: two calls on one script in one step fold into one operation
 * (`mergeKey`), checked on top of each other, so the proposal has one
 * snapshot to undo to. The ids the edit minted come back to the model, so it
 * can anchor the next edit on a line it has just proposed.
 *
 * Comments are a reader's (D2): a reader may propose and apply a comment, and
 * nothing else here. A comment cannot be taken back - a thread is append-only
 * - and the card says so before it is applied. Format and pagination are
 * `confirm`: both re-measure every page of the project.
 */

const EpisodeNumber = z.number().int().min(1).optional().describe('The episode, by its number. Omit for the one the writer has open.')

type Failure = { readonly status: string; readonly message?: string }

const failure = (result: Failure, fallback: string): ExecOutcome => ({ ok: false, message: result.message ?? fallback })

// ---------------------------------------------------------------------------
// The node list
// ---------------------------------------------------------------------------

const ScriptEditInput = z.object({
  episode: EpisodeNumber,
  ops: z
    .array(ScriptOpInputSchema)
    .min(1)
    .max(200)
    .describe('Operations in order. Anchor on node ids from read_scene or search_project, or "start"; never invent an id.'),
})

const OutlineEditInput = z.object({ episode: EpisodeNumber, ops: z.array(OutlineOpInputSchema).min(1).max(200) })

const PriorOps = z.object({ ops: z.array(z.unknown()) })

const documentTool = <Input extends { readonly episode?: number | undefined; readonly ops: readonly unknown[] }, Op extends ScriptOp | OutlineOp>(spec: {
  readonly name: 'propose_script_edit' | 'propose_outline_edit'
  readonly kind: 'script' | 'outline'
  readonly description: string
  readonly input: z.ZodType<Input>
  readonly prepare: (ctx: ToolContext, ordinal: number | undefined, ops: Input['ops'], prior: readonly Op[]) => ReturnType<typeof prepareScriptEdit> | ReturnType<typeof prepareOutlineEdit>
}): Tool =>
  defineTool<Input>({
    name: spec.name,
    description: spec.description,
    toolset: 'script',
    minimumRole: ROLE.authoredEdit,
    mode: 'propose',
    input: spec.input,
    label: () => (spec.kind === 'script' ? 'Proposing a script edit' : 'Proposing an outline edit'),
    run: async (ctx, input) => {
      const episode = await episodeNumbered(ctx.gate, input.episode)
      if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
      const mergeKey = `${spec.kind}:${episode.id}`
      const earlier = PriorOps.safeParse(ctx.proposals.earlier(mergeKey))
      const prior = (earlier.success ? earlier.data.ops : []) as readonly Op[]
      const prepared = await spec.prepare(ctx, episode.ordinal, input.ops, prior)
      if (!prepared.ok) return { ok: false, message: prepared.message }
      const label = spec.kind === 'script' ? (ctx.gate.project.projectType === 'film' ? 'Script' : `Script, episode ${String(episode.ordinal)}`) : `Outline, episode ${String(episode.ordinal)}`
      const description = describeEdit(label, prepared.args.ops, spec.kind === 'script' ? 'line' : 'block')
      ctx.proposals.propose({ tool: spec.name, args: prepared.args, mode: 'propose', description, base: prepared.base, mergeKey })
      const minted = insertedIds(prepared.args.ops.slice(prior.length))
      return {
        ok: true,
        content: {
          proposed: description,
          newNodeIds: minted,
          status: 'The writer will review this as a diff; nothing has changed yet.',
        },
        summary: `Proposed: ${description}`,
      }
    },
  })

export const proposeScriptEdit = documentTool<z.infer<typeof ScriptEditInput>, ScriptOp>({
  name: 'propose_script_edit',
  kind: 'script',
  description:
    "Propose an edit to an episode's script as node operations: insert_after (new lines after a node id, or at \"start\"), replace_content, change_type, delete, move. " +
    'Types are scene, action, character, paren, dialogue, transition, comment, subtitle. Content is plain text, or runs with a mention of a character or location by its record id. ' +
    'Read the scene first; anchor on real node ids; use bound cue and slugline spellings exactly. The writer sees it as a diff and applies it.',
  input: ScriptEditInput,
  prepare: (ctx, ordinal, ops, prior) => prepareScriptEdit(ctx.gate, ordinal, ops, prior),
})

export const proposeOutlineEdit = documentTool<z.infer<typeof OutlineEditInput>, OutlineOp>({
  name: 'propose_outline_edit',
  kind: 'outline',
  description:
    "Propose an edit to an episode's outline with the same operations. Block types are body, h1 (an act), h2, h3, quote, rule and beat. The writer sees it as a diff and applies it.",
  input: OutlineEditInput,
  prepare: (ctx, ordinal, ops, prior) => prepareOutlineEdit(ctx.gate, ordinal, ops, prior),
})

// ---------------------------------------------------------------------------
// The title page
// ---------------------------------------------------------------------------

const FieldInput = z.string().max(2000)
const TitlePageEdit = z.object(Object.fromEntries(TITLE_PAGE_FIELDS.map((field) => [field, FieldInput.optional()])) as Record<(typeof TITLE_PAGE_FIELDS)[number], z.ZodOptional<z.ZodString>>)
const CoverSchema = z.object(Object.fromEntries(TITLE_PAGE_FIELDS.map((field) => [field, z.string().nullable()])) as Record<(typeof TITLE_PAGE_FIELDS)[number], z.ZodNullable<z.ZodString>>)
const TitlePageArgs = z.object({ episode: z.string(), ordinal: z.number().int(), cover: CoverSchema, edited: z.array(z.string()) })

const coverOf = (page: TitlePage | null): z.infer<typeof CoverSchema> => {
  const cover: Record<string, string | null> = {}
  for (const field of TITLE_PAGE_FIELDS) cover[field] = page?.[field] ?? null
  return CoverSchema.parse(cover)
}

const asInput = (cover: z.infer<typeof CoverSchema>): Record<string, string> => Object.fromEntries(TITLE_PAGE_FIELDS.map((field) => [field, cover[field] ?? '']))

export const saveTitlePageTool = defineWriteTool({
  name: 'save_title_page',
  description: "Propose changes to an episode's title page: title, credit, author, source, draftDate, contact, copyright, notes. Only the fields you name change; an empty string clears one.",
  toolset: 'script',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: z.object({ episode: EpisodeNumber, fields: TitlePageEdit }),
  label: () => 'Proposing a title page',
  prepare: async (ctx, input) => {
    const episode = await episodeNumbered(ctx.gate, input.episode)
    if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
    const edited = Object.entries(input.fields).filter(([, value]) => value !== undefined)
    if (edited.length === 0) return { ok: false, message: 'The edit names no field.' }
    const current = coverOf(await readTitlePage(ctx.gate.scope, episode.id))
    const cover = { ...current, ...Object.fromEntries(edited.map(([field, value]) => [field, value === undefined || value.trim() === '' ? null : value.trim()])) }
    return { ok: true, args: { episode: episode.slug, ordinal: episode.ordinal, cover: CoverSchema.parse(cover), edited: edited.map(([field]) => field) } }
  },
  executor: {
    args: TitlePageArgs,
    describe: (args) => `Title page: ${args.edited.join(', ')}`,
    target: () => ({ type: 'title_page', id: null }),
    capture: async (ctx, args) => {
      const episode = (await episodeNumbered(ctx.gate, args.ordinal)) ?? ctx.gate.episode
      return coverOf(await readTitlePage(ctx.gate.scope, episode.id))
    },
    run: async (ctx, args) => {
      const result = await saveTitlePage(ctx.gate.project.id, args.episode, asInput(args.cover))
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The title page could not be saved.')
    },
    invert: async (ctx, args, undo) => {
      const prior = CoverSchema.parse(undo)
      const episode = (await episodeNumbered(ctx.gate, args.ordinal)) ?? ctx.gate.episode
      const now = coverOf(await readTitlePage(ctx.gate.scope, episode.id))
      if (JSON.stringify(now) !== JSON.stringify(args.cover)) {
        return { kind: 'changed', note: 'The title page was edited after the run.', ops: [{ tool: 'save_title_page', args: { ...args, cover: prior }, mode: 'propose' }] }
      }
      const result = await saveTitlePage(ctx.gate.project.id, args.episode, asInput(prior))
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: async (ctx, args, op) => {
      const episode = (await episodeNumbered(ctx.gate, args.ordinal)) ?? ctx.gate.episode
      const before = op.status === 'pending' ? coverOf(await readTitlePage(ctx.gate.scope, episode.id)) : (CoverSchema.safeParse(op.undo).data ?? null)
      return {
        changes: args.edited.map((field) => ({ field, before: before?.[field as (typeof TITLE_PAGE_FIELDS)[number]] ?? null, after: args.cover[field as (typeof TITLE_PAGE_FIELDS)[number]] })),
        open: { route: 'script', episode: args.ordinal },
      }
    },
  },
})

// ---------------------------------------------------------------------------
// Comments - a reader's (D2)
// ---------------------------------------------------------------------------

const Body = z.string().trim().min(1).max(4000)

export const commentOnNodeTool = defineWriteTool({
  name: 'comment_on_node',
  description: 'Propose a comment on one line of the script (or a block of the outline), by its node id - a note for the writer, not a change to the page. Comments never reach an export.',
  toolset: 'script',
  minimumRole: ROLE.comment,
  mode: 'propose',
  input: z.object({ episode: EpisodeNumber, nodeId: NodeIdSchema, body: Body, on: z.enum(['script', 'outline']).default('script') }),
  label: () => 'Proposing a comment',
  prepare: async (ctx, input) => {
    const episode = await episodeNumbered(ctx.gate, input.episode)
    return episode === null ? { ok: false, message: `There is no episode ${String(input.episode)}.` } : { ok: true, args: { episode: episode.slug, nodeId: input.nodeId, body: input.body, on: input.on } }
  },
  executor: {
    args: z.object({ episode: z.string(), nodeId: z.uuid(), body: z.string(), on: z.enum(['script', 'outline']) }),
    describe: (args) => `Comment: "${args.body.length > 80 ? `${args.body.slice(0, 77)}...` : args.body}"`,
    target: (args) => ({ type: 'node', id: args.nodeId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await openThreadOnNode(ctx.gate.project.id, args.episode, args.nodeId, args.body, args.on === 'script' ? 'script_node' : 'outline_block')
      return result.status === 'ok' ? { ok: true, result: { threadId: result.thread.id } } : failure(result, 'The comment could not be added.')
    },
  },
})

export const replyThreadTool = defineWriteTool({
  name: 'reply_thread',
  description: 'Propose a reply in a comment thread - a thread of notes on the page, not a story thread on the Timeline.',
  toolset: 'script',
  minimumRole: ROLE.comment,
  mode: 'propose',
  input: z.object({ episode: EpisodeNumber, threadId: ThreadIdSchema, nodeId: NodeIdSchema.describe('The node the thread is on.'), body: Body }),
  label: () => 'Proposing a reply',
  prepare: async (ctx, input) => {
    const episode = await episodeNumbered(ctx.gate, input.episode)
    return episode === null ? { ok: false, message: `There is no episode ${String(input.episode)}.` } : { ok: true, args: { episode: episode.slug, threadId: input.threadId, nodeId: input.nodeId, body: input.body } }
  },
  executor: {
    args: z.object({ episode: z.string(), threadId: z.uuid(), nodeId: z.uuid(), body: z.string() }),
    describe: (args) => `Reply: "${args.body.length > 80 ? `${args.body.slice(0, 77)}...` : args.body}"`,
    target: (args) => ({ type: 'comment_thread', id: args.threadId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await replyThread(ctx.gate.project.id, args.episode, args.threadId, args.nodeId, args.body)
      return result.status === 'ok' ? { ok: true, result: { threadId: args.threadId } } : failure(result, 'The reply could not be added.')
    },
  },
})

export const resolveThreadTool = defineWriteTool({
  name: 'resolve_thread',
  description: 'Propose resolving a comment thread the page has answered.',
  toolset: 'script',
  minimumRole: ROLE.comment,
  mode: 'propose',
  input: z.object({ episode: EpisodeNumber, threadId: ThreadIdSchema }),
  label: () => 'Proposing to resolve a thread',
  prepare: async (ctx, input) => {
    const episode = await episodeNumbered(ctx.gate, input.episode)
    return episode === null ? { ok: false, message: `There is no episode ${String(input.episode)}.` } : { ok: true, args: { episode: episode.slug, threadId: input.threadId } }
  },
  executor: {
    args: z.object({ episode: z.string(), threadId: z.uuid() }),
    describe: () => 'Resolve a comment thread',
    target: (args) => ({ type: 'comment_thread', id: args.threadId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await resolveThread(ctx.gate.project.id, args.episode, args.threadId)
      return result.status === 'done' ? { ok: true, result: { resolved: args.threadId } } : failure(result, 'The thread could not be resolved.')
    },
  },
})

// ---------------------------------------------------------------------------
// Format and pagination - confirm
// ---------------------------------------------------------------------------

const FORMAT_LABEL = { hollywood: 'Hollywood', asian: 'Asian' } as const

export const setFormatTool = defineWriteTool({
  name: 'set_format',
  description: "Propose the project's script format: hollywood or asian. It changes line widths, page counts and page numbers across every episode; the writer always confirms it.",
  toolset: 'script',
  minimumRole: ROLE.authoredEdit,
  mode: 'confirm',
  input: z.object({ format: ScriptFormatSchema }),
  label: () => 'Proposing a format',
  prepare: (ctx, input) =>
    Promise.resolve(input.format === ctx.gate.project.format ? { ok: false as const, message: `The project is already ${FORMAT_LABEL[input.format]}.` } : { ok: true as const, args: { format: input.format, episode: ctx.gate.episode.slug } }),
  executor: {
    args: z.object({ format: ScriptFormatSchema, episode: z.string() }),
    describe: (args) => `Set the script format to ${FORMAT_LABEL[args.format]} - every page is re-measured`,
    target: () => ({ type: 'project', id: null }),
    capture: async (ctx) => ({ format: (await readProject(ctx.gate.scope))?.format ?? ctx.gate.project.format }),
    run: async (ctx, args) => {
      const result = await setFormat(ctx.gate.project.id, args.episode, args.format)
      return result.status === 'done' ? { ok: true, result: { format: args.format } } : failure(result, 'The format could not be set.')
    },
    invert: async (ctx, args, undo) => {
      const prior = z.object({ format: ScriptFormatSchema }).parse(undo)
      const result = await setFormat(ctx.gate.project.id, args.episode, prior.format)
      return result.status === 'done' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: async (ctx, args, op) => ({
      changes: [{ field: 'Format', before: op.status === 'pending' ? FORMAT_LABEL[(await readProject(ctx.gate.scope))?.format ?? ctx.gate.project.format] : null, after: FORMAT_LABEL[args.format] }],
    }),
  },
})

const controlOf = (pageMode: string, live: boolean): PaginationControl => (pageMode === 'continuous' ? 'minimal' : live ? 'live' : 'paged')

export const setPaginationTool = defineWriteTool({
  name: 'set_pagination',
  description: 'Propose how the script is paged on screen: "minimal" (continuous), "paged", or "live" (paged, repaginating as the writer types). The writer always confirms it.',
  toolset: 'script',
  minimumRole: ROLE.authoredEdit,
  mode: 'confirm',
  input: z.object({ control: z.enum(PAGINATION_CONTROLS) }),
  label: () => 'Proposing pagination',
  prepare: (ctx, input) => Promise.resolve({ ok: true as const, args: { control: input.control, episode: ctx.gate.episode.slug } }),
  executor: {
    args: z.object({ control: z.enum(PAGINATION_CONTROLS), episode: z.string() }),
    describe: (args) => `Set pagination to ${args.control}`,
    target: () => ({ type: 'project', id: null }),
    capture: async (ctx) => {
      const project = (await readProject(ctx.gate.scope)) ?? ctx.gate.project
      return { control: controlOf(project.pageMode, project.liveRepaginate) }
    },
    run: async (ctx, args) => {
      const result = await setPagination(ctx.gate.project.id, args.episode, args.control)
      return result.status === 'done' ? { ok: true, result: { control: args.control } } : failure(result, 'Pagination could not be set.')
    },
    invert: async (ctx, args, undo) => {
      const prior = z.object({ control: z.enum(PAGINATION_CONTROLS) }).parse(undo)
      const result = await setPagination(ctx.gate.project.id, args.episode, prior.control)
      return result.status === 'done' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
  },
})

export const SCRIPT_WRITE_TOOLS: readonly WriteTool[] = [saveTitlePageTool, commentOnNodeTool, replyThreadTool, resolveThreadTool, setFormatTool, setPaginationTool]

/** The two node-list tools: their executors are `document-ops.ts`'s, registered with the rest. */
export const DOCUMENT_TOOLS: readonly Tool[] = [proposeScriptEdit, proposeOutlineEdit]
