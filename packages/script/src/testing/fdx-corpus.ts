/**
 * The Final Draft corpus.
 *
 * Real `.fdx` text, read by `fdx-reader.ts` into the `FdxNode` tree the mapping
 * takes. Held as strings for the same reason the Fountain corpus is: this
 * package may not import `node:fs`.
 *
 * `REPAGINATED_FDX` is hand-written in the shape a repaginated Final Draft
 * export arrives in, and carries, deliberately, every case the mapping has to
 * get right at once:
 *
 *   - a page split: `(MORE)`, then the cue again with `(CONT'D)`, then the rest
 *     of the speech, which must collapse back to one cue and one speech;
 *   - a speaker continued after an action line, which is *not* a page split and
 *     must keep its cue;
 *   - `(V.O.) (CONT’D)` on one cue, with a smart apostrophe, where the modifier
 *     is kept and the continued is not;
 *   - `<SceneProperties Page Length>` and `Number`, which AGENTS.md forbids a
 *     node from carrying and which must be discarded and counted;
 *   - a `Type="Scene Heading"` paragraph reading `INTERCUT - PHONE CALL`, which
 *     Final Draft declared a heading and which must therefore be a Scene node -
 *     but a reported one, never a silent one;
 *   - a `<ScriptNote>` anchored inside a paragraph, which is a Comment node;
 *   - `<DualDialogue>`, `Shot`, `New Act`, `Cast List` and an invented type,
 *     none of which have a member of the closed union.
 *
 * `featureLengthFdx` is synthetic, assembled deterministically to feature
 * length so the import counts are counts over a real volume. It is not a real
 * screenplay; the report says so.
 */

const paragraph = (type: string, text: string): string =>
  `    <Paragraph Type="${type}"><Text>${text}</Text></Paragraph>`

const heading = (text: string, page: number, eighths: string, number: number): string =>
  `    <Paragraph Number="${number}" Type="Scene Heading"><SceneProperties Length="${eighths}" Page="${page}" Title=""/><Text>${text}</Text></Paragraph>`

export const REPAGINATED_FDX = [
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  '<FinalDraft DocumentType="Script" Template="No" Version="5">',
  '  <Content>',
  heading('INT. MEERAS FLAT - NIGHT', 12, '3/8', 24),
  '    <Paragraph Type="Action"><Text>Rain on the window. MEERA counts notes onto the table.</Text><ScriptNote ID="1"><Paragraph><Text>is the rain too much</Text></Paragraph></ScriptNote></Paragraph>',
  paragraph('Character', 'MEERA'),
  paragraph('Dialogue', 'You said the fifteenth. It is the twenty-first.'),
  paragraph('Dialogue', '(MORE)'),
  paragraph('Character', "MEERA (CONT'D)"),
  paragraph('Dialogue', 'I am not asking for the whole of it.'),
  paragraph('Action', 'The LANDLORD does not sit down.'),
  paragraph('Character', 'MEERA (CONT’D)'),
  paragraph('Dialogue', 'Sit down.'),
  paragraph('Character', 'LANDLORD'),
  paragraph('Parenthetical', '(not looking up)'),
  paragraph('Dialogue', 'I have twelve rooms in this building.'),
  paragraph('Character', 'MEERA (V.O.) (CONT’D)'),
  paragraph('Dialogue', 'He had twelve rooms and no time at all.'),
  heading('INTERCUT - PHONE CALL', 13, '1/8', 25),
  paragraph('Shot', 'ANGLE ON THE TELEPHONE'),
  paragraph('General', 'A note to the production office.'),
  '    <DualDialogue>',
  paragraph('Character', 'ARJUN'),
  paragraph('Dialogue', 'At the same time.'),
  paragraph('Character', 'KAMLA'),
  paragraph('Dialogue', 'And so does she.'),
  '    </DualDialogue>',
  paragraph('New Act', 'ACT TWO'),
  paragraph('Cast List', 'MEERA, ARJUN, THE LANDLORD'),
  paragraph('Invented Type', 'Something Final Draft 14 added.'),
  paragraph('Transition', 'CUT TO:'),
  '  </Content>',
  '  <TitlePage>',
  '    <Content>',
  paragraph('Normal', 'THE CHAWL'),
  paragraph('Normal', 'written by A Writer'),
  '    </Content>',
  '  </TitlePage>',
  '</FinalDraft>',
].join('\n')

// ---------------------------------------------------------------------------
// A feature-length export
// ---------------------------------------------------------------------------

/** Deterministic. `packages/script` has no `Math.random()` and neither does its corpus. */
const stepper = (seed: number): (() => number) => {
  let state = seed % 2147483647
  return () => {
    state = (state * 48271) % 2147483647
    return state
  }
}

const pick = <T>(items: readonly [T, ...T[]], n: number): T =>
  items[Math.abs(n) % items.length] ?? items[0]

const SETS = [
  'MEERAS FLAT',
  'THE CHAWL - STAIRWELL',
  'THE CHAWL - COURTYARD',
  'RAILWAY PLATFORM 4',
  'A TAXI',
  'THE MILL - FLOOR',
  'THE MILL - OFFICE',
  'ARJUNS ROOM',
  'A TEA STALL',
  'THE MAGISTRATES COURT',
] as const
const PREFIXES = ['INT.', 'EXT.', 'INT./EXT.', 'I/E.', 'EST.'] as const
const TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'DAWN', 'DUSK'] as const
const NAMES = ['MEERA', 'ARJUN', 'THE LANDLORD', 'KAMLA', 'INSPECTOR RAO', 'THE CLERK'] as const
const ACTIONS = [
  'She does not look back.',
  'The rain stops as suddenly as it started.',
  'A door closes somewhere below.',
  'He counts the notes twice and puts them away.',
  'The fan turns. Nobody speaks.',
  'Outside, a train.',
] as const
const SPEECHES = [
  'You said the fifteenth. It is the twenty-first.',
  'I am not asking for the whole of it.',
  'There is nothing in this building that is mine.',
  'Sit down. Please.',
  'He wrote it down. I watched him write it down.',
  'Twelve rooms and not one of them warm.',
] as const
const PARENS = ['(beat)', '(quietly)', '(in Hindi)', '(not looking up)'] as const
const EIGHTHS = ['1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '1'] as const
const MALFORMED = ['INTERCUT - PHONE CALL', 'EXTREME CLOSE UP', 'ESTABLISHING SHOT'] as const

/**
 * A feature-length export.
 *
 * Every seventh speech is split across a page the way a repaginated export
 * splits one; every eleventh scene ends on a speaker `(CONT'D)` after an action
 * line; every thirteenth scene opens with a heading-shaped line Final Draft has
 * been told is a heading. Every scene carries a page number and an eighths
 * length, so `discarded` is non-zero at volume.
 */
export const featureLengthFdx = (scenes = 220): string => {
  const next = stepper(20260910)
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    '  <Content>',
  ]
  let speeches = 0
  let page = 1

  for (let scene = 0; scene < scenes; scene += 1) {
    const n = next()
    page += scene % 2
    lines.push(
      heading(
        `${pick(PREFIXES, n)} ${pick(SETS, n >> 3)} - ${pick(TIMES, n >> 7)}`,
        page,
        pick(EIGHTHS, n >> 9),
        scene + 1,
      ),
      paragraph('Action', pick(ACTIONS, n >> 11)),
      paragraph('Action', pick(ACTIONS, n >> 13)),
    )

    if (scene % 13 === 0) {
      lines.push(heading(pick(MALFORMED, n), page, '1/8', scene + 1))
    }
    if (scene % 17 === 0) {
      lines.push(
        `    <Paragraph Type="Action"><Text>${pick(ACTIONS, n >> 17)}</Text><ScriptNote ID="${scene}"><Paragraph><Text>check this against the bible</Text></Paragraph></ScriptNote></Paragraph>`,
      )
    }
    if (scene % 23 === 0) {
      lines.push(paragraph('Shot', 'ANGLE ON THE DOOR'))
    }
    if (scene % 29 === 0) {
      lines.push(paragraph('New Act', 'ACT TWO'))
    }

    const speakers = 3 + ((n >> 5) % 4)
    let last = ''
    for (let speech = 0; speech < speakers; speech += 1) {
      const m = next()
      const name = pick(NAMES, m)
      const modifier = m % 11 === 0 ? ' (V.O.)' : ''
      lines.push(paragraph('Character', `${name}${modifier}`))
      if (m % 5 === 0) lines.push(paragraph('Parenthetical', pick(PARENS, m >> 4)))
      lines.push(paragraph('Dialogue', pick(SPEECHES, m >> 8)))
      if (m % 3 === 0) lines.push(paragraph('Dialogue', pick(SPEECHES, m >> 16)))

      // The paginator cut this speech in two.
      if (speeches % 7 === 6) {
        lines.push(
          paragraph('Dialogue', '(MORE)'),
          paragraph('Character', `${name}${modifier} (CONT'D)`),
          paragraph('Dialogue', pick(SPEECHES, m >> 12)),
        )
      }
      last = `${name}${modifier}`
      speeches += 1
    }

    // The same character again, after an action line. Not a page split.
    if (scene % 11 === 0 && last !== '') {
      lines.push(
        paragraph('Action', pick(ACTIONS, n >> 15)),
        paragraph('Character', `${last} (CONT’D)`),
        paragraph('Dialogue', pick(SPEECHES, n >> 19)),
      )
    }

    if (scene % 9 === 0) lines.push(paragraph('Transition', 'CUT TO:'))
  }

  lines.push(
    paragraph('Transition', 'FADE OUT.'),
    '  </Content>',
    '  <TitlePage><Content>',
    paragraph('Normal', 'THE CHAWL'),
    '  </Content></TitlePage>',
    '</FinalDraft>',
  )
  return lines.join('\n')
}
