/**
 * The eval's fixture stories - roadmap task 5.5, ADR 0003 **D19**. Ten, as the
 * writer would hand them over: four thin one-liners (the pipeline must
 * expand and state its assumptions - craft rule 13), three detailed
 * treatments (it must keep what it was given - rule 14), a series pilot, one
 * mixing Hindi and English (rule 9: the dialogue mixes too), and a short with
 * a hard length. The ids are stable: a report compares story by story across
 * runs, and `EVAL_STORIES` picks some by id.
 */

export type FixtureKind = 'one-liner' | 'treatment' | 'pilot' | 'mixed-language' | 'short'

export type Fixture = {
  readonly id: string
  readonly kind: FixtureKind
  readonly title: string
  readonly projectType: 'film' | 'series'
  readonly story: string
}

export const FIXTURES: readonly Fixture[] = [
  {
    id: 'ferry-son',
    kind: 'one-liner',
    title: 'The Last Ferry',
    projectType: 'film',
    story: 'A ferry captain in Kochi discovers that her last passenger of the night is the son she gave up twenty years ago.',
  },
  {
    id: 'monsoon-cart',
    kind: 'one-liner',
    title: 'One Cart',
    projectType: 'film',
    story: 'Two rival street-food vendors are forced to share a single cart for the length of a monsoon.',
  },
  {
    id: 'voicemail',
    kind: 'one-liner',
    title: 'Voicemail',
    projectType: 'film',
    story: 'A night-shift nurse keeps receiving voicemails from a patient who died last week.',
  },
  {
    id: 'chess-hustler',
    kind: 'one-liner',
    title: 'The Losing Game',
    projectType: 'film',
    story: 'An ageing chess hustler teaches a teenage runaway how to lose on purpose.',
  },
  {
    id: 'orchard-heist',
    kind: 'treatment',
    title: 'Apple Season',
    projectType: 'film',
    story: [
      'Himachal, late autumn. REKHA NEGI (58), a widowed orchard owner, learns the cold-storage company that buys her apples has been short-weighing every farmer in the valley for a decade.',
      'The co-operative will not act: its chairman, her late husband\'s best friend HARISH, takes a cut. Rekha recruits her college-dropout nephew DEV (22), who works nights at the cold store, and ANJALI (35), the bank clerk who processes the payments.',
      'Act one ends when they prove the scales are rigged. Act two is the plan: on the last truck of the season, they will weigh every crate twice, on camera, in front of the whole valley. Harish finds out and offers Rekha her husband\'s debt forgiven if she stops.',
      'The climax is the weighing: forty families in the cold-store yard at dawn, the scales, Harish arriving with the police. Rekha refuses the deal in front of everyone. The last image is the valley\'s farmers loading their own trucks for the city market.',
      'Tone: quiet, specific, dry humour. No villain speeches. About 20 pages.',
    ].join('\n\n'),
  },
  {
    id: 'wedding-audit',
    kind: 'treatment',
    title: 'Mehendi Night',
    projectType: 'film',
    story: [
      'A single night: the mehendi before PRIYA\'s wedding in a Lucknow haveli. Her father VIKRAM, a retired accountant, notices the wedding caterer\'s invoice is exactly twice what he agreed.',
      'He spends the night quietly auditing his own daughter\'s wedding - the florist, the band, the fireworks - while every relative asks him to dance. Each overcharge leads him to the same person: his brother SUNIL, who organised everything and is broke.',
      'Midpoint: Priya catches her father with a calculator under the table. She already knows; she let it happen because Sunil would lose his house.',
      'The ending: Vikram dances with his brother at dawn, invoice folded in his pocket, and says nothing. Warm comedy, ensemble, about 15 pages.',
    ].join('\n\n'),
  },
  {
    id: 'relay-station',
    kind: 'treatment',
    title: 'Relay',
    projectType: 'film',
    story: [
      'A two-hander on a deep-space relay station. OKAFOR, the station\'s only technician for three years, receives a replacement: a young engineer, LI WEI, who arrives with orders to decommission the station and a sealed message for Okafor from Earth.',
      'Okafor stalls the shutdown with invented faults. Li Wei plays along, then realises Okafor has been answering messages from a dead daughter, routed through the relay\'s archive.',
      'The turn: the sealed message is from the daughter, recorded before she died, asking her father to come home. The end: Okafor switches the relay off himself.',
      'Hard science where it shows; the drama is two people in a small room. About 12 pages.',
    ].join('\n\n'),
  },
  {
    id: 'newsroom-pilot',
    kind: 'pilot',
    title: 'The Night Desk',
    projectType: 'series',
    story: [
      'A series about the night desk of a struggling Bengaluru newspaper that has one year left in print. Each episode is one night and one front page.',
      'Pilot: the night editor MEENAKSHI RAO (44) inherits the desk when her boss has a heart attack at 9 pm. By 2 am she must choose the front page between a minister\'s corruption story that cannot be fully confirmed and a flood that has cut off half the city.',
      'The regulars: a cynical sub-editor, a 23-year-old reporter on her first night, a printer who has worked the press for thirty years, and the owner who calls at midnight.',
      'The pilot should set up the series\' engine - one night, one page, one impossible choice - and end on the page going to press, and the call that tells Meenakshi the minister knows what she almost printed.',
    ].join('\n\n'),
  },
  {
    id: 'dabba-mix',
    kind: 'mixed-language',
    title: 'Dabba',
    projectType: 'film',
    story: [
      'Mumbai. A dabbawala, GANESH, delivers the same tiffin to the same office clerk every day for eleven years. One day the tiffin comes back untouched, with a note in it: "कल से मत लाना." (Don\'t bring it from tomorrow.)',
      'Ganesh, who is not supposed to read the notes, goes looking for the woman who cooks the tiffin, SAVITA, in a chawl in Dadar. The characters speak the way people in Mumbai speak - Hindi and English mixed in the same sentence - and the dialogue should do the same, with the Hindi in Devanagari.',
      'Short, tender, funny. The ending is a new note in a new tiffin.',
    ].join('\n\n'),
  },
  {
    id: 'lift-short',
    kind: 'short',
    title: 'Lift',
    projectType: 'film',
    story: 'Two strangers are stuck in an office lift for eleven minutes, and one of them is about to be fired by the other. A short film: no more than five pages, one location.',
  },
]

/** The fixtures `EVAL_STORIES` names (comma-separated ids), or all of them. An unknown id is refused, not ignored. */
export const pickFixtures = (ids: string | null): { readonly ok: true; readonly fixtures: readonly Fixture[] } | { readonly ok: false; readonly message: string } => {
  if (ids === null || ids.trim() === '') return { ok: true, fixtures: FIXTURES }
  const wanted = ids.split(',').map((id) => id.trim()).filter((id) => id.length > 0)
  const unknown = wanted.filter((id) => !FIXTURES.some((fixture) => fixture.id === id))
  if (unknown.length > 0) return { ok: false, message: `No fixture called ${unknown.join(', ')}. The ids are: ${FIXTURES.map((fixture) => fixture.id).join(', ')}.` }
  return { ok: true, fixtures: FIXTURES.filter((fixture) => wanted.includes(fixture.id)) }
}
