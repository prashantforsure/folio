import type { AgentEvent, AgentOpMode, AgentRoute, MembershipRole, ProposalDocumentBase } from '@folio/contracts'
import type { RunId } from '@folio/script'
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { ROLE_REFUSED, meetsRole } from '../auth/roles'
import type { EpisodeGate, GateRefusal } from '../script/actor-gate'
import { stillMember } from '../script/actor-gate'

/**
 * The tool registry - ADR 0003 **D13**, `docs/agents/tools.md`.
 *
 * A tool is a name, a description, a toolset, a **minimum role**, a **mode**,
 * a Zod input schema and a `run(ctx, input)` function. The registry is the
 * only way the agent loop reaches one, and `runTool` below is the only way it
 * calls one: the input is parsed, the role is checked, and a throw becomes a
 * result - so a tool can be written as plainly as an action is.
 *
 * ## "A tool that is not in `tools.md` does not exist"
 *
 * `tools.md`'s closing rule, which this file makes checkable: every name
 * registered here is asserted against that file by `tests/agent-tools.test.ts`.
 * Adding a tool is a change to the catalogue and to this registry in the same
 * pull request.
 *
 * ## The role is checked here as well as in the core
 *
 * Since roadmap task 4.2 a tool calls **core functions** (`lib/<route>/core.ts`)
 * with the turn's gate rather than the cookie-gated actions, and each core
 * checks its own capability against the gate's role - the D2 matrix, applied
 * where the write is (`lib/auth/roles.ts`). The check here is the catalogue's
 * own column - a tool whose minimum is `writer` refuses a `reader` before it
 * touches anything, with the gate's own words (`ROLE_REFUSED`). Two checks of
 * one table, not two tables. And because a core trusts the gate it is handed,
 * `runTool` also asks whether the person is still a member (`stillMember`),
 * once per step: the wrapped actions' cookie gates used to, on every call.
 *
 * ## Schemas come from Zod, converted once
 *
 * D13: "Tool input schemas come from `@folio/contracts`, converted with Zod 4's
 * `z.toJSONSchema`." Where a tool's input is an existing contract it uses that
 * schema; where a tool is new (most Phase 2 reads), its schema is written with
 * the tool, and moves to contracts when a second reader appears.
 */

/** `tools.md`, *Modes*. Phase 2 registered only `read` and `client` tools; Phase 3 adds the writes (AGENTS.md ruling R8). */
export const TOOL_MODES = ['read', 'propose', 'confirm', 'paid', 'direct', 'client'] as const

export type ToolMode = (typeof TOOL_MODES)[number]

/**
 * `tools.md`'s sections, as loadable sets. `core` loads every turn; the
 * route's set loads with it (`toolsetForRoute`); `load_toolset` adds another.
 * `launcher` is the panel's outside a project, where no model turn runs yet
 * (ruled 2026-09-23) - its tools are registered and tested all the same.
 */
export const TOOLSETS = ['core', 'launcher', 'script', 'entities', 'timeline', 'research', 'storyboard', 'production'] as const

export type Toolset = (typeof TOOLSETS)[number]

export const ToolsetSchema = z.enum(TOOLSETS)

/**
 * What a tool runs as: the gate the turn opened. `episode` is the one the
 * panel reads - every chat belongs to an episode, so a turn always has one.
 *
 * It **is** an episode gate (`lib/script/actor-gate.ts`), so a tool hands it
 * straight to a core function (roadmap task 4.2); its scope may be either
 * pooler's, because a background run's comes from the worker's session pooler.
 */
export type ToolGate = EpisodeGate

/**
 * One operation a write tool asks for (roadmap Phase 3). It is not applied by
 * the tool: the loop collects a step's operations and writes them as
 * proposals once every call of the step has run (`loop.ts`).
 */
export type ProposedOp = {
  readonly tool: string
  readonly args: unknown
  readonly mode: AgentOpMode
  /** Code's words for it (the executor's `describe`), for the summary and the tool result. */
  readonly description: string
  /** The document it was planned against, for D10's compare-and-swap. */
  readonly base?: ProposalDocumentBase | undefined
  /**
   * A second call with the same key in one step folds into the first - two
   * edits to one script become one operation, so its undo is one snapshot.
   */
  readonly mergeKey?: string | undefined
  /**
   * A `paid` operation's credits, from `GENERATION_COSTS` (roadmap task 5.1).
   * The proposal carries the sum as `credit_cost`; confirming it grants the
   * run exactly that budget (ADR 0003 D3).
   */
  readonly cost?: number | undefined
}

/** What a `direct` tool gets back: it ran at once, as a one-operation proposal already applied. */
export type DirectOutcome = { readonly ok: true; readonly proposalId: string; readonly result: unknown } | { readonly ok: false; readonly message: string }

/** A turn's proposal machinery, as a tool sees it. */
export type Proposing = {
  /** Queue an operation for this step's proposal. */
  readonly propose: (op: ProposedOp) => void
  /** The args of an operation already queued this step under `mergeKey`, if any. */
  readonly earlier: (mergeKey: string) => unknown
  /** Run a `direct` operation now: it lands as proposed rows, or only cancels something. */
  readonly applyNow: (op: ProposedOp) => Promise<DirectOutcome>
}

export type ToolContext = {
  readonly gate: ToolGate
  readonly runId: RunId
  /**
   * The API's `tool_use` id - D13's idempotency key. A retried tool call is
   * indistinguishable from a second intentional one, and every create a tool
   * makes (Phase 3) passes this so the retry gets the first row back.
   */
  readonly idempotencyKey: string
  /** Send an event to the panel: a navigation, a download, a refresh. */
  readonly emit: (event: AgentEvent) => void
  /** The route the turn was asked from, when the caller knows it - what a background run started here reads (roadmap task 4.4). */
  readonly route?: AgentRoute | null
  /** Toolsets this turn has loaded beyond the core and the route's - `load_toolset` adds to it. */
  readonly loaded: Set<Toolset>
  /** Where a write tool puts what it would change (Phase 3). */
  readonly proposals: Proposing
  /**
   * Whether the gate's person is still a member - memoised by the loop for
   * one step, so a step's tools cost one read between them. Absent (a tool
   * called outside the loop), `runTool` asks for itself.
   */
  readonly membership?: () => Promise<GateRefusal | null>
}

/**
 * A tool's answer. `content` goes back to the model as the `tool_result`,
 * serialised as JSON; `summary` is the short line the panel prints beside the
 * tool's name - computed by code, never the model's words (AGENTS.md ruling
 * R4, "the numbers always come from code").
 */
export type ToolResult =
  | { readonly ok: true; readonly content: unknown; readonly summary: string }
  | { readonly ok: false; readonly message: string }

/** A tool as it is written: its input typed by its own schema. */
export type ToolDefinition<Input> = {
  readonly name: string
  readonly description: string
  readonly toolset: Toolset
  /** `tools.md`'s role column. `null` is its `user`: any signed-in person, the launcher's, outside a project. */
  readonly minimumRole: MembershipRole | null
  readonly mode: ToolMode
  readonly input: z.ZodType<Input>
  /** The status line while it runs: `Reading the scene list`. */
  readonly label: (input: Input) => string
  readonly run: (ctx: ToolContext, input: Input) => Promise<ToolResult>
}

/**
 * A tool as the registry holds it: the input erased to `unknown`, which each
 * tool parses with its own schema before its typed `run` sees it. A parse
 * failure is a result the model can correct, not a throw.
 */
export type Tool = Omit<ToolDefinition<unknown>, 'label' | 'run'> & {
  readonly label: (raw: unknown) => string
  readonly run: (ctx: ToolContext, raw: unknown) => Promise<ToolResult>
}

const unreadable = (error: z.ZodError): ToolResult => {
  const issue = error.issues[0]
  return { ok: false, message: `The input did not read${issue === undefined ? '' : ` (${issue.path.join('.') || 'input'}: ${issue.message})`}.` }
}

/** Typed at the definition, erased in the registry - through a parse, never a cast. */
export const defineTool = <Input>(tool: ToolDefinition<Input>): Tool => ({
  name: tool.name,
  description: tool.description,
  toolset: tool.toolset,
  minimumRole: tool.minimumRole,
  mode: tool.mode,
  input: tool.input,
  label: (raw) => {
    const parsed = tool.input.safeParse(raw ?? {})
    return parsed.success ? tool.label(parsed.data) : tool.name
  },
  run: async (ctx, raw) => {
    const parsed = tool.input.safeParse(raw ?? {})
    return parsed.success ? tool.run(ctx, parsed.data) : unreadable(parsed.error)
  },
})

const registry = new Map<string, Tool>()

/** Register tools. A second tool with a name already taken is a programming error, not a turn's. */
export const registerTools = (tools: readonly Tool[]): void => {
  for (const tool of tools) {
    if (registry.has(tool.name)) throw new Error(`Folio: the tool ${tool.name} is registered twice.`)
    registry.set(tool.name, tool)
  }
}

export const registeredTools = (): readonly Tool[] => [...registry.values()]

export const toolNamed = (name: string): Tool | undefined => registry.get(name)

/** The toolset a route loads beside the core. */
export const toolsetForRoute = (route: AgentRoute | null): Toolset | null => {
  switch (route) {
    case 'script':
    case 'outline':
    case 'scenes':
      return 'script'
    case 'characters':
    case 'locations':
    case 'props':
      return 'entities'
    case 'timeline':
      return 'timeline'
    case 'research':
      return 'research'
    case 'storyboard':
      return 'storyboard'
    case 'production':
      return 'production'
    case null:
      return null
  }
}

/**
 * The tools a turn offers: the core set, the route's, and whatever
 * `load_toolset` has added - in registry order, so the tool block is stable
 * between turns and the cache marker on its last entry keeps hitting.
 * The launcher set never loads inside a project.
 */
export const toolsFor = (route: AgentRoute | null, loaded: ReadonlySet<Toolset>): readonly Tool[] => {
  const sets = new Set<Toolset>(['core', ...loaded])
  const own = toolsetForRoute(route)
  if (own !== null) sets.add(own)
  sets.delete('launcher')
  return registeredTools().filter((tool) => sets.has(tool.toolset))
}

/** A tool's input schema as the API takes it: JSON Schema, an object, no `$schema` key. */
export const inputSchemaOf = (tool: Tool): Anthropic.Tool.InputSchema => {
  const { $schema: _dropped, ...schema } = z.toJSONSchema(tool.input, { io: 'input' }) as Record<string, unknown>
  return { ...schema, type: 'object' }
}

/**
 * The `tools` block. **D13's caching**: the last definition carries the
 * `cache_control` marker, so the whole block is part of the cached prefix
 * with the system block before it.
 */
export const toolDefinitions = (tools: readonly Tool[]): Anthropic.Tool[] =>
  tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: inputSchemaOf(tool),
    ...(index === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

/**
 * Call a tool, the one way the loop does. Never throws: an unknown name, an
 * input that does not parse, a role below the minimum and a tool that throws
 * all come back as `{ ok: false }`, which the loop hands the model as an
 * `is_error` result it can recover from.
 */
export const runTool = async (name: string, rawInput: unknown, ctx: ToolContext, offered: readonly Tool[]): Promise<ToolResult> => {
  const tool = offered.find((entry) => entry.name === name)
  if (tool === undefined) return { ok: false, message: `There is no tool called ${name} on this turn.` }
  if (tool.minimumRole !== null && !meetsRole(ctx.gate.role, tool.minimumRole)) return { ok: false, message: ROLE_REFUSED }
  try {
    // A project tool runs only for a member who still is one: the wrapped
    // actions' cookie gates re-read the membership on every call, and the
    // core functions the tools call now (roadmap task 4.2) trust their gate.
    if (tool.minimumRole !== null) {
      const gone = await (ctx.membership ?? (() => stillMember(ctx.gate)))()
      if (gone !== null) return { ok: false, message: gone.message }
    }
    return await tool.run(ctx, rawInput)
  } catch (cause) {
    console.error({ event: 'folio.agent.tool_threw', tool: name, message: cause instanceof Error ? cause.message : String(cause) })
    return { ok: false, message: `${name} could not run.` }
  }
}

/** A tool's status line, falling back to its name when the label itself cannot read the input. */
export const labelOf = (name: string, rawInput: unknown, offered: readonly Tool[]): string => {
  const tool = offered.find((entry) => entry.name === name)
  return tool === undefined ? name : tool.label(rawInput)
}
