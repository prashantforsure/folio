import type { AgentAutonomy, ProposalDocumentBase } from '@folio/contracts'
import { needsConfirmation } from '@folio/contracts'
import { createProposal, readProposal, readProposalOpByKey } from '@folio/db'
import type { RunId } from '@folio/script'

import type { Schedule } from '../script/server'

import { applyProposalWith, summaryOf } from './apply'
import type { ProposalMade, ProposalSink } from './loop'
import type { ToolGate } from './registry'

/**
 * Where a turn's proposals are written - roadmap tasks 3.5 and 3.7, ADR 0003
 * **D1**.
 *
 * `create` turns each group the loop hands it into one `agent_proposals` row
 * with its operations: the summary is the operations' own descriptions,
 * joined (code's words); the base is every document the operations were
 * planned against; `needs_confirmation` is set when any operation is
 * `confirm` or `paid`. A group whose first key already has an operation - a
 * replayed tool call (D13) - finds that proposal instead of writing another.
 *
 * `applyNow` is a `direct` tool's: a one-operation proposal, applied at once.
 *
 * ## Autonomy (roadmap task 3.7, D1)
 *
 * Under `review` every proposal waits. Under `auto` one that needs no
 * confirmation applies as soon as it is made: a proposal of **records only**
 * is applied here, in the turn; one that edits the script or the outline is
 * returned `auto`, and the panel applies it - so a document the writer has
 * open is still written by their editor (D10 path A), never over it. A
 * `confirm` or `paid` operation never applies without a click, whatever the
 * setting: `applyProposalWith` refuses it without `confirmed`.
 */
export const proposalSink = (gate: ToolGate, run: RunId, autonomy: AgentAutonomy = 'review', schedule?: Schedule): ProposalSink => ({
  create: async (groups) => {
    const made: ProposalMade[] = []
    for (const group of groups) {
      const first = group.ops[0]
      if (first === undefined) continue
      const replayed = await readProposalOpByKey(gate.scope, first.key)
      if (replayed !== null) {
        const earlier = await readProposal(gate.scope, replayed.proposalId)
        if (earlier !== null) {
          made.push({ proposalId: earlier.proposal.id, runId: run, summary: earlier.proposal.summary, needsConfirmation: earlier.proposal.needsConfirmation, auto: false })
          continue
        }
      }
      const asks = group.ops.some((entry) => needsConfirmation(entry.op.mode))
      const documents = new Map<string, ProposalDocumentBase>()
      for (const entry of group.ops) if (entry.op.base !== undefined) documents.set(entry.op.base.documentId, entry.op.base)
      const summary = summaryOf(group.ops.map((entry) => entry.op.description).join('; '))
      const created = await createProposal(gate.scope, {
        runId: run,
        episodeId: gate.episode.id,
        summary,
        base: { documents: [...documents.values()] },
        needsConfirmation: asks,
        creditCost: null,
        ops: group.ops.map((entry) => ({ tool: entry.op.tool, args: entry.op.args, mode: entry.op.mode, idempotencyKey: entry.key })),
      })
      if (autonomy === 'auto' && !asks && documents.size === 0) {
        const outcome = await applyProposalWith(gate, created.proposal.id, { confirmed: false, ...(schedule === undefined ? {} : { schedule }) })
        made.push({ proposalId: created.proposal.id, runId: run, summary, needsConfirmation: false, auto: false, applied: outcome.status === 'applied' })
        continue
      }
      made.push({ proposalId: created.proposal.id, runId: run, summary, needsConfirmation: asks, auto: autonomy === 'auto' && !asks })
    }
    return made
  },
  applyNow: async (op, key) => {
    const created = await createProposal(gate.scope, {
      runId: run,
      episodeId: gate.episode.id,
      summary: summaryOf(op.description),
      base: { documents: op.base === undefined ? [] : [op.base] },
      needsConfirmation: false,
      creditCost: null,
      ops: [{ tool: op.tool, args: op.args, mode: 'direct', idempotencyKey: key }],
    })
    const outcome = await applyProposalWith(gate, created.proposal.id, { confirmed: true, ...(schedule === undefined ? {} : { schedule }) })
    if (outcome.status === 'applied') return { ok: true, proposalId: created.proposal.id, result: outcome.proposal.ops[0]?.result ?? null }
    if (outcome.status === 'refused' || outcome.status === 'decided' || outcome.status === 'needs-confirmation') return { ok: false, message: outcome.message }
    if (outcome.status === 'editor') return { ok: false, message: 'That cannot run from here.' }
    return { ok: false, message: outcome.failure ?? 'It could not run.' }
  },
})
