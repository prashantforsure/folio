import type { RunId } from './ids'

/**
 * Where a node came from.
 *
 * AGENTS.md, The node model: "Every node records provenance: **typed or
 * agent**, and which run."
 *
 * A discriminated union rather than `isAgent: boolean` plus a nullable
 * `runId`, so "agent-authored with no run" is unrepresentable rather than
 * merely discouraged (AGENTS.md, Development philosophy 6).
 */
export type Provenance =
  | { readonly source: 'typed' }
  | { readonly source: 'agent'; readonly runId: RunId }

export const PROVENANCE_SOURCES = ['typed', 'agent'] as const

export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number]

export const typed = (): Provenance => ({ source: 'typed' })

export const byAgent = (run: RunId): Provenance => ({ source: 'agent', runId: run })

export const isAgentAuthored = (provenance: Provenance): boolean => provenance.source === 'agent'
