import { z } from 'zod'

/**
 * The model-judged half of the eval - roadmap task 5.5, ADR 0003 **D19**. The
 * rubric is `docs/agents/craft.md` itself: its numbered rules are read out of
 * the file (`craftRules`), so a change to the craft rules is a change to what
 * is measured, with nothing to keep in step by hand.
 *
 * The judge scores each rule 1 (broken) to 5 (kept) and quotes the weakest
 * lines. A quote is only reported if code finds it in the script
 * (`verifiedSpots`) - a judge that paraphrases does not get to put words in
 * the draft's mouth - and the mean is code's arithmetic, never the model's.
 */

export type CraftRule = { readonly number: number; readonly text: string }

/** The numbered rules of `craft.md`, each with its wrapped lines joined. */
export const craftRules = (markdown: string): readonly CraftRule[] => {
  const rules: { number: number; text: string }[] = []
  for (const line of markdown.split(/\r?\n/u)) {
    const opens = /^(\d+)\.\s+(.*)$/u.exec(line)
    if (opens !== null) {
      rules.push({ number: Number(opens[1]), text: (opens[2] ?? '').trim() })
      continue
    }
    const last = rules.at(-1)
    if (last !== undefined && /^\s{2,}\S/u.test(line)) last.text = `${last.text} ${line.trim()}`
    else if (line.trim() !== '' && last !== undefined && !/^\s/u.test(line)) break
  }
  return rules
}

export const JudgeSchema = z.object({
  scores: z
    .array(z.object({ rule: z.int().min(1).max(40), score: z.int().min(1).max(5), note: z.string().trim().max(300) }))
    .min(1)
    .describe('One score per craft rule you can judge from the draft: 1 broken throughout, 3 kept unevenly, 5 kept throughout.'),
  weakSpots: z
    .array(z.object({ rule: z.int().min(1).max(40), quote: z.string().trim().min(1).max(400).describe('A line copied exactly from the draft, character for character.'), note: z.string().trim().max(300) }))
    .max(8)
    .describe('The weakest lines, each quoted exactly, with the rule it breaks.'),
  summary: z.string().trim().max(600).describe('Two or three sentences a writer would act on.'),
})

export type Judgement = z.infer<typeof JudgeSchema>

export const JUDGE_SYSTEM =
  'You are a script editor scoring a draft against a house style guide. You are exact, specific and unsentimental. You quote the draft only by copying its lines exactly.'

export const judgePrompt = (rules: readonly CraftRule[], story: string, script: string): string =>
  [
    'The craft rules:',
    ...rules.map((rule) => `${String(rule.number)}. ${rule.text}`),
    '',
    'The story the writer gave:',
    story,
    '',
    'The draft, in Fountain:',
    script,
    '',
    'Score the draft against each rule you can judge from it, 1 to 5. Then quote up to eight of its weakest lines, each copied exactly from the draft, with the rule it breaks and why, and sum up in two or three sentences.',
  ].join('\n')

/** The judge's quotes that are really in the draft - whitespace-insensitive, never paraphrased. */
export const verifiedSpots = (spots: Judgement['weakSpots'], script: string): { readonly kept: Judgement['weakSpots']; readonly dropped: number } => {
  const flat = (text: string): string => text.replace(/\s+/gu, ' ').trim().toLowerCase()
  const haystack = flat(script)
  const kept = spots.filter((spot) => haystack.includes(flat(spot.quote)))
  return { kept, dropped: spots.length - kept.length }
}

/** The mean score, to one decimal; null with nothing scored. */
export const meanScore = (scores: Judgement['scores']): number | null => (scores.length === 0 ? null : Math.round((scores.reduce((total, score) => total + score.score, 0) / scores.length) * 10) / 10)
