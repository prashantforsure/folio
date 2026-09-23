// @vitest-environment node
import {
  AGENT_EPISODE_ROUTES,
  AGENT_PROJECT_ROUTES,
  AgentEventSchema,
  AssistantMessageSchema,
  NavigateTargetSchema,
} from '@folio/contracts'
import { describe, expect, it } from 'vitest'

import { EPISODE_ROUTES, PROJECT_ROUTES } from '../lib/workspace/routes'

/**
 * The agent's wire shapes (roadmap task 2.1, `@folio/contracts` `agent.ts`).
 *
 * What can go wrong at a boundary is a shape one side accepts and the other
 * refuses, so these assert the shapes as the panel will meet them: one line of
 * the stream per event kind, a message that is only a tool call, and the route
 * names the navigate target may carry against the app's own route tree.
 */

const PROJECT = '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'
const RUN = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'
const NODE = '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98'

describe('AgentEventSchema', () => {
  const lines: readonly unknown[] = [
    { type: 'text', text: 'Forty-one scenes.' },
    { type: 'tool_started', id: 'toolu_01', name: 'list_scenes', label: 'Reading the scene list' },
    { type: 'tool_finished', id: 'toolu_01', name: 'list_scenes', ok: true, summary: '41 scenes' },
    { type: 'proposal', proposalId: RUN, runId: RUN, summary: 'Two lines in Scene 4', needsConfirmation: false, auto: false },
    { type: 'confirm_required', id: 'toolu_02', name: 'shoot_reel', summary: 'Shoot reel 2', cost: 375 },
    { type: 'navigate', target: { kind: 'episode', projectId: PROJECT, shape: 'collapsed', episode: 'ep_001', route: 'script', sceneNodeId: NODE } },
    { type: 'refresh' },
    { type: 'download', filename: 'Harbour-Lights.fountain', mime: 'text/plain', text: 'INT. HARBOUR - NIGHT\n' },
    { type: 'error', message: 'That tool could not run.' },
    { type: 'done', runId: RUN, status: 'succeeded', stopReason: 'end_turn' },
  ]

  it('reads one line of each of the ten kinds', () => {
    const kinds = lines.map((line) => AgentEventSchema.parse(line).type)
    expect(new Set(kinds).size).toBe(10)
  })

  it('refuses a kind it does not know rather than passing it through', () => {
    expect(AgentEventSchema.safeParse({ type: 'mutate', nodes: [] }).success).toBe(false)
  })

  it('refuses a navigate target that names no route the app has', () => {
    expect(NavigateTargetSchema.safeParse({ kind: 'route', projectId: PROJECT, route: 'insights' }).success).toBe(false)
  })
})

describe('AssistantMessageSchema', () => {
  const base = {
    id: RUN,
    projectId: PROJECT,
    chatId: RUN,
    role: 'assistant' as const,
    runId: RUN,
    createdAt: '2026-09-23T10:00:00.000Z',
  }

  it('takes a turn that is only a tool call - no text, a content list', () => {
    const parsed = AssistantMessageSchema.safeParse({
      ...base,
      body: '',
      content: [{ type: 'tool_use', id: 'toolu_01', name: 'list_scenes', input: {} }],
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses a turn with neither text nor content, as the database check does', () => {
    expect(AssistantMessageSchema.safeParse({ ...base, body: '  ', content: null }).success).toBe(false)
  })

  it('still takes a turn written before the loop: text, no content, no run', () => {
    expect(AssistantMessageSchema.safeParse({ ...base, body: 'An answer.', content: null, runId: null }).success).toBe(true)
  })
})

describe('the route names a navigate target may carry', () => {
  it('are the route tree`s own, episode and project routes alike', () => {
    expect([...AGENT_EPISODE_ROUTES]).toEqual([...EPISODE_ROUTES])
    expect([...AGENT_PROJECT_ROUTES]).toEqual([...PROJECT_ROUTES])
  })
})
