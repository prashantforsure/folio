// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AGENT_AUTONOMIES,
  AGENT_OP_MODES,
  AGENT_OP_STATUSES,
  AGENT_PROPOSAL_STATUSES,
  AgentProposalOpSchema,
  AgentProposalSchema,
  ProposalBaseSchema,
  VersionSchema,
  isOpenProposal,
  needsConfirmation,
} from '@folio/contracts'
import { createProposal } from '@folio/db'
import type { ProjectScope } from '@folio/db'
import { agentAutonomyEnum, agentOpModeEnum, agentOpStatusEnum, agentProposalStatusEnum, users, versions } from '@folio/db/schema'
import { runId } from '@folio/script'
import { describe, expect, it } from 'vitest'

/**
 * Proposal storage - roadmap task 3.1, ADR 0003 **D1**, **D11**.
 *
 * The contracts and the schema are two declarations of one set of statuses, so
 * the first thing held here is that they agree; then the shapes the card and
 * `apply.ts` will read; then the migration's promises that no type can check -
 * row-level security on both new tables, and every existing user reading back
 * as `review`.
 */

const PROJECT = '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'
const RUN = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'
const PROPOSAL = '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98'
const DOCUMENT = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const EPISODE = '1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'
const USER = '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b'

const MIGRATION = readFileSync(join(__dirname, '..', '..', '..', 'packages', 'db', 'migrations', '0035_agent_proposals.sql'), 'utf8')

describe('the statuses, in contracts and in the schema', () => {
  it('declares the six proposal statuses the task names, and the schema enum is the same list', () => {
    expect(AGENT_PROPOSAL_STATUSES).toEqual(['pending', 'applied', 'rejected', 'stale', 'failed', 'partially_applied'])
    expect(agentProposalStatusEnum.enumValues).toEqual([...AGENT_PROPOSAL_STATUSES])
  })

  it('keeps the operation statuses and modes in step with their enums', () => {
    expect(agentOpStatusEnum.enumValues).toEqual([...AGENT_OP_STATUSES])
    expect(agentOpModeEnum.enumValues).toEqual([...AGENT_OP_MODES])
  })

  it('has two autonomy settings, review first - the default (D1)', () => {
    expect(AGENT_AUTONOMIES).toEqual(['review', 'auto'])
    expect(agentAutonomyEnum.enumValues).toEqual(['review', 'auto'])
    expect(users.agentAutonomy.default).toBe('review')
    expect(users.agentAutonomy.notNull).toBe(true)
  })

  it('makes confirm and paid always ask, and propose and direct not (D1)', () => {
    expect(AGENT_OP_MODES.filter(needsConfirmation)).toEqual(['confirm', 'paid'])
  })

  it('treats only pending as a proposal that can still be decided', () => {
    expect(AGENT_PROPOSAL_STATUSES.filter(isOpenProposal)).toEqual(['pending'])
  })
})

describe('the shapes', () => {
  const proposal = {
    id: PROPOSAL,
    projectId: PROJECT,
    runId: RUN,
    episodeId: EPISODE,
    status: 'pending',
    summary: 'Create MEERA; two lines in Scene 4',
    base: { documents: [{ documentId: DOCUMENT, kind: 'screenplay', episodeId: EPISODE, digest: 'a'.repeat(64) }] },
    needsConfirmation: false,
    creditCost: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-23T10:00:00.000Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
  }

  it('reads a proposal with the base it was planned against', () => {
    const parsed = AgentProposalSchema.parse(proposal)
    expect(parsed.base.documents[0]?.kind).toBe('screenplay')
  })

  it('refuses a proposal whose status is not one of the six', () => {
    expect(AgentProposalSchema.safeParse({ ...proposal, status: 'applying' }).success).toBe(false)
  })

  it('refuses a negative cost - a cost is named before it is spent, and is never a refund', () => {
    expect(AgentProposalSchema.safeParse({ ...proposal, creditCost: -4 }).success).toBe(false)
  })

  it('refuses a base document of a kind that is not the script or the outline', () => {
    expect(ProposalBaseSchema.safeParse({ documents: [{ documentId: DOCUMENT, kind: 'title_page', episodeId: EPISODE, digest: 'x' }] }).success).toBe(false)
  })

  it('reads an operation with a null undo - one that cannot be put back', () => {
    const op = AgentProposalOpSchema.parse({
      id: RUN,
      projectId: PROJECT,
      proposalId: PROPOSAL,
      seq: 0,
      tool: 'merge_entities',
      args: { entity: 'character', loser: DOCUMENT, winner: EPISODE },
      mode: 'confirm',
      idempotencyKey: 'toolu_01ABC',
      status: 'applied',
      result: { status: 'merged' },
      undo: null,
      appliedAt: '2026-09-23T10:01:00.000Z',
    })
    expect(op.undo).toBeNull()
  })

  it('gives a version the run it was taken for, and null for every other snapshot', () => {
    const base = { id: PROPOSAL, projectId: PROJECT, documentId: DOCUMENT, ordinal: 3, nodeCount: 120, createdBy: USER, createdAt: '2026-09-23T10:00:00.000Z' }
    expect(VersionSchema.parse({ ...base, reason: 'before_agent_run', runId: RUN }).runId).toBe(RUN)
    expect(VersionSchema.parse({ ...base, reason: 'autosave', runId: null }).runId).toBeNull()
    expect(versions.runId.notNull).toBe(false)
  })
})

describe('the repository', () => {
  it('refuses a proposal with no operations before it reaches the database', async () => {
    await expect(
      createProposal({} as ProjectScope, { runId: runId(RUN), episodeId: null, summary: 'Nothing', base: { documents: [] }, needsConfirmation: false, creditCost: null, ops: [] }),
    ).rejects.toThrow('at least one operation')
  })
})

describe('migration 0035', () => {
  it('turns on row-level security for both new tables, members only, nothing for anon', () => {
    for (const table of ['agent_proposals', 'agent_proposal_ops']) {
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon`)
      expect(MIGRATION).toMatch(new RegExp(`CREATE POLICY ${table}_member_all ON public\\.${table}[\\s\\S]*?folio_is_member\\(project_id\\)`))
    }
  })

  it('adds the two columns additively - a default for users, nullable for versions', () => {
    expect(MIGRATION).toContain(`ALTER TABLE "users" ADD COLUMN "agent_autonomy" "agent_autonomy" DEFAULT 'review' NOT NULL`)
    expect(MIGRATION).toContain(`ALTER TABLE "versions" ADD COLUMN "run_id" uuid;`)
    expect(MIGRATION).not.toMatch(/DROP (TABLE|COLUMN)/)
  })

  it('makes an operation unique per project by its idempotency key, so a replayed tool call proposes nothing twice', () => {
    expect(MIGRATION).toContain(`CREATE UNIQUE INDEX "agent_proposal_ops_project_key" ON "agent_proposal_ops" USING btree ("project_id","idempotency_key")`)
  })
})
