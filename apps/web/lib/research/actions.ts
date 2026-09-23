'use server'

import {
  ResearchClipEditSchema,
  ResearchClipIdSchema,
  ResearchFilingIdSchema,
  ResearchFilingTargetSchema,
  ResearchSourceEditSchema,
  ResearchSourceIdSchema,
} from '@folio/contracts'
import type { ResearchClipId, ResearchFilingId, ResearchSourceId } from '@folio/contracts'
import {
  createResearchClip,
  createResearchSource,
  deleteResearchClip,
  deleteResearchSource,
  fileResearchClip,
  unfileResearchClip,
  updateResearchSource,
} from '@folio/db'
import { revalidatePath } from 'next/cache'
import type { z } from 'zod'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import { isRefusal, openProject } from '../script/gate'
import type { ClipResult, DeleteResult, FiledResult, SourceResult, UnfiledResult } from './result'

/**
 * The Research route's writes. Every one goes gate -> repository -> result
 * through the project-scoped gate in `lib/script/gate.ts` - identity,
 * membership, scope, project - and every input is parsed at this boundary
 * before a repository sees it. Every write is `ROLE.authoredEdit` - a
 * writer's under ADR 0003 D2. (The *agent* gets no Research write tool at
 * all, under D16; that is tool exposure, and this is the role gate.)
 *
 * Nothing here touches the script. A filing points a clip at a scene; it
 * writes no node, and there is no operation on this route that could.
 * Nothing re-derives either: no table `derive` reads changed.
 *
 * Each write revalidates the workspace layout so the router re-reads
 * `loadResearch` - the sidebar's counts, the widget and the page share
 * that one read.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const UNREADABLE = 'That edit could not be read.'
const MISSING_SOURCE = 'That source could not be found.'

const parse = <S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> | null => {
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const addSource = async (projectId: string, rawEdit: unknown, rawKey: unknown = null): Promise<SourceResult> => {
  const edit = parse(ResearchSourceEditSchema, rawEdit)
  if (edit === null) return { status: 'error', message: 'A source needs a title, up to 200 characters.' }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await createResearchSource(gate.scope, edit, key.key)
  if (!result.ok) return { status: 'refused', message: 'That collection is not in this project.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', id: result.id }
}

export const saveSource = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SourceResult> => {
  const id: ResearchSourceId | null = parse(ResearchSourceIdSchema, rawId)
  const edit = parse(ResearchSourceEditSchema, rawEdit)
  if (id === null || edit === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await updateResearchSource(gate.scope, id, edit)
  if (!result.ok) {
    return result.reason === 'missing'
      ? { status: 'refused', message: MISSING_SOURCE }
      : { status: 'refused', message: 'That collection is not in this project.' }
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', id }
}

export const removeSource = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const id: ResearchSourceId | null = parse(ResearchSourceIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const deleted = await deleteResearchSource(gate.scope, id)
  if (!deleted) return { status: 'refused', message: MISSING_SOURCE }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export const clipLine = async (projectId: string, rawSourceId: string, rawEdit: unknown): Promise<ClipResult> => {
  const sourceId: ResearchSourceId | null = parse(ResearchSourceIdSchema, rawSourceId)
  const edit = parse(ResearchClipEditSchema, rawEdit)
  if (sourceId === null || edit === null) return { status: 'error', message: 'A clip is a line of the source, up to 2,000 characters.' }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const id = await createResearchClip(gate.scope, sourceId, edit.text)
  if (id === null) return { status: 'refused', message: MISSING_SOURCE }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'clipped', id }
}

export const removeClip = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const id: ResearchClipId | null = parse(ResearchClipIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const deleted = await deleteResearchClip(gate.scope, id)
  if (!deleted) return { status: 'refused', message: 'That clip could not be found.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

export const sendClip = async (projectId: string, rawClipId: string, rawTarget: unknown): Promise<FiledResult> => {
  const clipId: ResearchClipId | null = parse(ResearchClipIdSchema, rawClipId)
  const target = parse(ResearchFilingTargetSchema, rawTarget)
  if (clipId === null || target === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await fileResearchClip(gate.scope, clipId, target)
  if (!result.ok) {
    switch (result.reason) {
      case 'clip':
        return { status: 'refused', message: 'That clip could not be found.' }
      case 'target':
        return { status: 'refused', message: 'That place is not in this project any more.' }
      case 'duplicate':
        return { status: 'refused', message: 'Already filed there.' }
    }
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'filed', id: result.id }
}

export const unsendClip = async (projectId: string, rawId: string): Promise<UnfiledResult> => {
  const id: ResearchFilingId | null = parse(ResearchFilingIdSchema, rawId)
  if (id === null) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const removed = await unfileResearchClip(gate.scope, id)
  if (!removed) return { status: 'refused', message: 'That filing could not be found.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'unfiled' }
}
