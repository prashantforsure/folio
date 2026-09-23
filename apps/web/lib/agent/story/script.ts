import type { DraftLine, EpisodeId, ProposalDocumentBase, StoryBible, StoryOutline, StoryScene } from '@folio/contracts'
import type { BoundSpellings, DocumentId, DraftIssue, NodeId, OutlineOp, RunId, ScreenplayNode, ScreenplayNodeType, ScriptOp } from '@folio/script'
import { applyScriptOps, byAgent, canonicalScreenplay, checkDraft, text } from '@folio/script'

import { nodeDigest } from '../../script/server'

/**
 * The story pipeline's writes, as the operations the write tools would
 * propose - roadmap task 4.5.
 *
 * **The model never writes a cue or a heading.** A scene's heading is its
 * place, the location's bound slugline spelling and its time; a cue is the
 * bound cue spelling the model chose from the list it was given. Every scene is
 * then held to the bound spellings by `checkDraft` (`@folio/script`) before it
 * can be proposed: a miss is repaired, or the scene is refused.
 *
 * **Batches are chained.** Scenes land as script proposals of about five, all
 * of them proposed before the writer applies the first. Each is planned on the
 * script as the batches before it will leave it - anchored after the last node
 * the previous batch adds, its base digest taken over that projected list in
 * the form a stored copy reads back in (`canonicalScreenplay`), so once the
 * writer applies them in order each finds exactly the script it was planned on
 * (D10). One applied out of order, or after the writer typed, is stale, and
 * the pipeline plans it again on the script as it is.
 */

export const BATCH_SIZE = 5

/** One line of a scene before its id: a type and its text. */
export type LineDraft = { readonly type: ScreenplayNodeType; readonly text: string }

const parenthesised = (line: string): string => {
  const inner = line.trim()
  return inner.startsWith('(') && inner.endsWith(')') ? inner : `(${inner.replace(/^\(|\)$/gu, '')})`
}

/** A scene's heading as the project spells its place. */
export const headingOf = (scene: StoryScene, set: string): string => `${scene.place}. ${set} - ${scene.time.trim().toUpperCase()}`

/** A scene as lines: its heading, then what the model wrote, each cue the bound spelling it chose. */
export const sceneLines = (scene: StoryScene, set: string, lines: readonly DraftLine[]): readonly LineDraft[] => [
  { type: 'scene', text: headingOf(scene, set) },
  ...lines.flatMap((line): LineDraft[] => {
    switch (line.type) {
      case 'action':
        return [{ type: 'action', text: line.text }]
      case 'transition':
        return [{ type: 'transition', text: line.text.trim().toUpperCase() }]
      case 'dialogue':
        return [
          { type: 'character', text: line.character },
          ...(line.parenthetical === null || line.parenthetical.trim() === '' ? [] : [{ type: 'paren' as const, text: parenthesised(line.parenthetical) }]),
          { type: 'dialogue', text: line.text },
        ]
    }
  }),
]

/** Lines given ids, as nodes - `checkDraft`'s input and the insert's payload. */
export const nodesOf = (lines: readonly LineDraft[], ids: readonly NodeId[], run: RunId): readonly ScreenplayNode[] =>
  lines.map((line, index) => {
    const id = ids[index]
    if (id === undefined) throw new Error('Folio: fewer ids than lines.')
    const base = { id, provenance: byAgent(run), content: [text(line.text)] }
    return line.type === 'character' ? { type: 'character', ...base, modifiers: [] } : ({ type: line.type, ...base } as ScreenplayNode)
  })

export type HeldScene = { readonly ok: true; readonly nodes: readonly ScreenplayNode[]; readonly repaired: readonly DraftIssue[] } | { readonly ok: false; readonly rejected: readonly DraftIssue[] }

/** A scene held to the bound spellings: repaired, or refused with what was wrong. */
export const holdScene = (nodes: readonly ScreenplayNode[], bound: BoundSpellings): HeldScene => {
  const checked = checkDraft(nodes, bound)
  return checked.rejected.length > 0 ? { ok: false, rejected: checked.rejected } : { ok: true, nodes: checked.nodes, repaired: checked.repaired }
}

/** The insert operation for a batch of scenes, as a stored `propose_script_edit` operation carries it. */
export const insertOp = (anchor: NodeId | 'start', nodes: readonly ScreenplayNode[]): ScriptOp => ({
  op: 'insert_after',
  anchor,
  nodes: nodes.map((node) => ({ id: node.id, type: node.type, content: node.content, modifiers: node.type === 'character' ? node.modifiers : [] })),
})

export type PlannedBatch =
  | { readonly ok: true; readonly op: ScriptOp; readonly base: ProposalDocumentBase; readonly projected: readonly ScreenplayNode[] }
  | { readonly ok: false; readonly message: string }

/**
 * Plan a batch on the script as the batches before it will leave it:
 * `projected` is the stored list with every earlier, still unapplied batch
 * applied in order. The base is that list's digest in its stored form.
 */
export const planBatch = (
  document: { readonly documentId: DocumentId; readonly episodeId: EpisodeId },
  projected: readonly ScreenplayNode[],
  nodes: readonly ScreenplayNode[],
  run: RunId,
): PlannedBatch => {
  const last = projected.at(-1)
  const op = insertOp(last === undefined ? 'start' : last.id, nodes)
  const after = applyScriptOps(projected, [op], byAgent(run))
  if (!after.ok) return { ok: false, message: 'The batch would not fit the script.' }
  return {
    ok: true,
    op,
    base: { documentId: document.documentId, kind: 'screenplay', episodeId: document.episodeId, digest: nodeDigest(canonicalScreenplay(projected)) },
    projected: after.value,
  }
}

/** The script as an earlier batch will leave it - the projection the next is planned on. */
export const projectBatch = (projected: readonly ScreenplayNode[], ops: readonly ScriptOp[], run: RunId): readonly ScreenplayNode[] | null => {
  const after = applyScriptOps(projected, ops, byAgent(run))
  return after.ok ? after.value : null
}

// ---------------------------------------------------------------------------
// The bible and the outline
// ---------------------------------------------------------------------------

const cut = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

/**
 * The bible's records as the create tools' stored arguments, those that exist
 * already (by name) left out. A character's voice note is `create_character`'s
 * `voice`, which lands in the record's `notes.voice` - never the bio, which is
 * the description alone. Stage E reads it back from the record (pre-deploy
 * fixes, 2026-09-24; `0021`'s voice columns are the derivation's counts).
 */
export const bibleOps = (bible: StoryBible, existing: { readonly characters: readonly string[]; readonly locations: readonly string[] }) => {
  const taken = (names: readonly string[]) => new Set(names.map((name) => name.trim().toUpperCase()))
  const people = taken(existing.characters)
  const places = taken(existing.locations)
  return {
    characters: bible.characters
      .filter((person) => !people.has(person.name.trim().toUpperCase()))
      .map((person) => ({ name: person.name.trim(), role: cut(person.role, 200), bio: cut(person.description, 20_000), voice: cut(person.voice, 600) })),
    locations: bible.locations.filter((place) => !places.has(place.name.trim().toUpperCase())).map((place) => ({ name: place.name.trim(), parent: null })),
  }
}

/** The outline as blocks after the outline's last one: each act an `h1`, each beat a `beat` block. */
export const outlineOp = (outline: StoryOutline, anchor: NodeId | 'start', ids: readonly NodeId[]): OutlineOp => {
  const blocks = outline.acts.flatMap((act) => [
    { type: 'h1' as const, text: act.title },
    ...act.beats.map((beat) => ({ type: 'beat' as const, text: `${beat.title}: ${beat.summary}` })),
  ])
  return {
    op: 'insert_after',
    anchor,
    nodes: blocks.map((block, index) => {
      const id = ids[index]
      if (id === undefined) throw new Error('Folio: fewer ids than blocks.')
      return { id, type: block.type, content: [text(block.text)], modifiers: [] }
    }),
  }
}

/** How many blocks `outlineOp` writes. */
export const outlineBlockCount = (outline: StoryOutline): number => outline.acts.reduce((total, act) => total + 1 + act.beats.length, 0)
