# Story-to-script evals

The copilot's writing, measured: roadmap task 5.5, ADR 0003 **D19**. Run it on
demand only, never in CI. It calls a model, costs money, and is not
deterministic.

## What it does

For each of the ten stories in `fixtures.ts`, the harness:

1. Makes a scratch project called `eval · <id> · <time>`, owned by the eval
   account.
2. Runs `story_to_script` in it, using the real pipeline, the real model and the
   real proposals.
3. Plays a writer who says yes to everything: at each stop it applies every
   pending proposal and approves the checkpoint.
4. Scores the draft it ends with, as below.

The drafts are scored in two ways:

- **Structure**, decided by code (`structural.ts`):
  - the script parses as a screenplay, reading back from Fountain as the same
    elements;
  - after the run's re-derive, no cue is unresolved;
  - the script opens on a heading, every heading reads as a slugline, and there
    is one for every planned scene.
- **Craft**, judged by the model (`rubric.ts`): each numbered rule in
  `docs/agents/craft.md` gets a score from 1 to 5, and the weakest lines are
  quoted. A quote is only reported if code finds it in the draft. The rubric is
  read from `craft.md` itself, so it cannot drift from the rules the pipeline
  writes to.

The report is written to `evals/reports/story-to-script-<time>.md`, a folder
git ignores. It has a table for every story and a section per story, with that
story's stated assumptions, its rubric and its quoted weak spots.

## Running it

```bash
# in apps/web/.env, or the environment:
#   the database variables the app uses, ANTHROPIC_API_KEY,
#   EVAL_USER_EMAIL=<an account that exists - sign up in the app first>
pnpm eval                                        # all ten
EVAL_STORIES=ferry-son,dabba-mix pnpm eval       # some, by id
```

Needs Node 22.12 or later, as the web tests do.

## Costs and leftovers

- **Tokens.** A thin story takes about eight jobs and a few dozen model calls.
  Every token is recorded on the scratch run and counts against the eval
  account's daily cap (D3). Each story is capped at `STORY_TOKENS`.
- **No credits.** The pipeline spends none: drafting is free.
- **Scratch projects are kept.** Deleting user data is on AGENTS.md's
  ask-first list, and the drafts are what a reviewer reads. Trash them from
  `/app/projects` when you are done.
- **No worker job is ever queued.** The harness runs the jobs in its own
  process, so a worker on the same database never picks one up.

## The limits under load

`pnpm eval:limits` (`limits.eval.ts`, roadmap task 5.6) fires more concurrent
requests than each D3/D14 limit allows and counts what got through. The limits
checked are:

- the assistant and generate rate limits;
- the two-live-runs cap;
- the run credit budget;
- the daily token meter.

It calls no model and spends no credits. It needs only the database and
`EVAL_USER_EMAIL`. It writes `evals/reports/limits-<time>.md`, and trashes its
scratch project when it is done. The window it fills is the eval account's, on
that scratch project only.

Both evals share `vitest.config.mts`. It is `.mts` so Vite loads it as ESM.
