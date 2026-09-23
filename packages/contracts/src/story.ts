import { z } from 'zod'

/**
 * The story-to-script pipeline's shapes - roadmap task 4.5, ADR 0003 D4/D5.
 *
 * A `story_to_script` run turns a story into a draft in six stages. Each
 * stage's output is one of the schemas below: it is what the model is made to
 * produce (a forced tool call, parsed here and retried once when it does not
 * read) and what `agent_run_stages` stores (migration `0038`), so a crashed or
 * paused run picks up at the stage it reached rather than starting again.
 *
 *   A `expand`   the story, expanded - genre, tone, format, length, the
 *                protagonist's want and need, stakes, setting, assumptions.
 *                A checkpoint.
 *   B `bible`    the characters (with voice notes) and locations, as one
 *                proposal; their cue and slugline spellings bind when it is
 *                applied.
 *   C `outline`  acts and beats, as an outline proposal. A checkpoint.
 *   D `scenes`   the scene list, a synopsis each. A checkpoint.
 *   E `draft`    the scenes written one by one, critiqued against the craft
 *                rules, and proposed in batches of about five.
 *   F `finish`   re-derived, measured and checked; story days, synopses and
 *                threads proposed.
 *
 * The model never writes a cue or a heading: it names a character or a
 * location from the bible, and code writes the bound spelling
 * (`draftSceneSchema` takes the names it may use).
 */

export const STORY_STAGES = ['expand', 'bible', 'outline', 'scenes', 'draft', 'finish'] as const

export type StoryStage = (typeof STORY_STAGES)[number]

export const StoryStageSchema = z.enum(STORY_STAGES)

/**
 * The stages that stop for the writer's approval - A, C and D. Only the run
 * card's **Approve** moves one on (pre-deploy fixes, 2026-09-24): a reply with
 * words asks the stage again with them, and an empty reply does nothing. The
 * other stops (the bible, the batches, F) wait on proposals, not on approval.
 */
export const STORY_CHECKPOINTS = ['expand', 'outline', 'scenes'] as const satisfies readonly StoryStage[]

export type StoryCheckpoint = (typeof STORY_CHECKPOINTS)[number]

/**
 * Where a stage is. `ready`: its output is stored. `waiting`: it stopped for
 * the writer (a checkpoint, or proposals to apply). `approved`: the writer
 * carried on from its checkpoint.
 */
export const STORY_STAGE_STATUSES = ['ready', 'waiting', 'approved'] as const

export type StoryStageStatus = (typeof STORY_STAGE_STATUSES)[number]

export const StoryStageStatusSchema = z.enum(STORY_STAGE_STATUSES)

const line = (max: number) => z.string().trim().min(1).max(max)

// ---------------------------------------------------------------------------
// A - the story, expanded
// ---------------------------------------------------------------------------

export const StoryBriefSchema = z.object({
  logline: line(400),
  genre: line(80),
  tone: line(200),
  format: line(80).describe('What it is: "feature film", "short film", "a series pilot".'),
  targetPages: z.int().min(1).max(200).describe('The length to write to, in pages - a page is about a minute.'),
  protagonist: z.object({ name: line(60), want: line(400), need: line(400) }),
  stakes: line(600),
  setting: line(600),
  assumptions: z.array(line(300)).max(12).describe('What the story did not say and you decided - each one the writer may overrule.'),
})

export type StoryBrief = z.infer<typeof StoryBriefSchema>

// ---------------------------------------------------------------------------
// B - the bible: characters and locations
// ---------------------------------------------------------------------------

export const StoryBibleSchema = z.object({
  characters: z
    .array(
      z.object({
        name: line(60).describe('Their name as the script will cue it: "MEERA". Never a placeholder name.'),
        role: line(200),
        voice: line(600).describe('How they talk: rhythm, vocabulary, what they avoid saying.'),
        description: line(1_000),
      }),
    )
    .min(1)
    .max(20),
  locations: z
    .array(
      z.object({
        name: line(80).describe('The place as a slugline names it: "HOSPITAL WARD".'),
        description: line(600),
      }),
    )
    .min(1)
    .max(30),
})

export type StoryBible = z.infer<typeof StoryBibleSchema>

// ---------------------------------------------------------------------------
// C - the outline
// ---------------------------------------------------------------------------

export const StoryOutlineSchema = z.object({
  acts: z
    .array(
      z.object({
        title: line(120),
        beats: z.array(z.object({ title: line(120), summary: line(600) })).min(1).max(20),
      }),
    )
    .min(1)
    .max(6),
})

export type StoryOutline = z.infer<typeof StoryOutlineSchema>

// ---------------------------------------------------------------------------
// D - the scene list
// ---------------------------------------------------------------------------

export const SCENE_PLACES = ['INT', 'EXT', 'INT/EXT'] as const

/** One scene of the list. `location` and `characters` are bible names; `beat` is the outline beat it plays. */
export const sceneListSchema = (locations: readonly [string, ...string[]], characters: readonly [string, ...string[]]) =>
  z.object({
    scenes: z
      .array(
        z.object({
          beat: line(120),
          place: z.enum(SCENE_PLACES),
          location: z.enum(locations),
          time: line(20).describe('DAY, NIGHT, DUSK, MORNING, CONTINUOUS...'),
          synopsis: line(600),
          characters: z.array(z.enum(characters)).max(12),
        }),
      )
      .min(1)
      .max(120),
  })

/** The scene list as stored: the names are checked against the bible when it is made, and read back as text. */
export const StoredSceneListSchema = z.object({
  scenes: z
    .array(
      z.object({
        beat: z.string(),
        place: z.enum(SCENE_PLACES),
        location: z.string(),
        time: z.string(),
        synopsis: z.string(),
        characters: z.array(z.string()),
      }),
    )
    .min(1),
})

export type StorySceneList = z.infer<typeof StoredSceneListSchema>

export type StoryScene = StorySceneList['scenes'][number]

// ---------------------------------------------------------------------------
// E - one scene, drafted; its critique
// ---------------------------------------------------------------------------

/** One scene's lines. `character` is a bible name, never a spelling the model invents - code writes the bound cue. */
export const draftSceneSchema = (characters: readonly [string, ...string[]]) =>
  z.object({
    lines: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('action'), text: line(2_000) }),
          z.object({
            type: z.literal('dialogue'),
            character: z.enum(characters),
            parenthetical: z.string().trim().max(120).nullable().default(null),
            text: line(2_000),
          }),
          z.object({ type: z.literal('transition'), text: line(60) }),
        ]),
      )
      .min(1)
      .max(200),
  })

/** A scene's lines as stored and replayed: the same shape, the names read back as text. */
export const DraftLineSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('action'), text: z.string() }),
  z.object({ type: z.literal('dialogue'), character: z.string(), parenthetical: z.string().nullable(), text: z.string() }),
  z.object({ type: z.literal('transition'), text: z.string() }),
])

export type DraftLine = z.infer<typeof DraftLineSchema>

/** The critic's scores, one per craft rule it could judge, 1 (broken) to 5 (kept). */
export const CritiqueSchema = z.object({
  scores: z.array(z.object({ rule: z.int().min(1).max(20), score: z.int().min(1).max(5), note: z.string().trim().max(400) })).min(1).max(20),
})

export type Critique = z.infer<typeof CritiqueSchema>

/** A critique with any score below this gets one rewrite. */
export const CRITIC_THRESHOLD = 3

// ---------------------------------------------------------------------------
// F - story days and threads
// ---------------------------------------------------------------------------

export const StoryTimeProposalSchema = z.object({
  days: z
    .array(z.object({ scene: z.int().min(1), day: z.int().min(1).max(10_000), flashback: z.boolean().default(false) }))
    .max(200)
    .describe('The story day each scene happens on, by its number in the scene list; a flashback is on the day it shows.'),
  threads: z
    .array(z.object({ name: line(80), scenes: z.array(z.int().min(1)).min(1).max(200) }))
    .max(8)
    .describe('The story threads - a plot line, a relationship - and the scenes that carry each.'),
})

export type StoryTimeProposal = z.infer<typeof StoryTimeProposalSchema>

// ---------------------------------------------------------------------------
// The run's input, and what each stage stores
// ---------------------------------------------------------------------------

/** A `story_to_script` run's input (`agent_runs.input`): the story as the writer gave it. */
export const StoryToScriptInputSchema = z.object({
  kind: z.literal('story_to_script'),
  title: z.string().trim().min(1).max(120),
  story: z.string().trim().min(1).max(20_000),
})

export type StoryToScriptInput = z.infer<typeof StoryToScriptInputSchema>

/** One batch of drafted scenes and the proposal that carries it. */
export const DraftBatchSchema = z.object({
  /** The scene-list indexes it drafted, first and last, inclusive. */
  from: z.int().min(0),
  to: z.int().min(0),
  proposalId: z.uuid(),
  /** The last node it adds - the next batch anchors after it. */
  lastNodeId: z.uuid(),
  /** Each scene's heading node id, in order - the scene's id once applied (ADR 0003 D8). */
  headings: z.array(z.uuid()),
})

export type DraftBatch = z.infer<typeof DraftBatchSchema>

export const StageOutputSchemas = {
  expand: z.object({ brief: StoryBriefSchema }),
  bible: z.object({ bible: StoryBibleSchema, proposalId: z.uuid().nullable() }),
  outline: z.object({ outline: StoryOutlineSchema, proposalId: z.uuid().nullable() }),
  scenes: z.object({ list: StoredSceneListSchema }),
  draft: z.object({
    batches: z.array(DraftBatchSchema),
    /** The last lines of the last scene drafted - what the next scene is written on from. */
    tail: z.array(DraftLineSchema).max(12),
  }),
  finish: z.object({
    /** The story days, synopses and thread creations. */
    proposalId: z.uuid().nullable(),
    /** Which scenes go on which thread, by name - proposed once the threads exist. */
    threads: z.array(z.object({ name: z.string(), scenes: z.array(z.string()) })),
    threadsProposalId: z.uuid().nullable(),
  }),
} as const
