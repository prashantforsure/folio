# Running the copilot

**Status:** the operator's guide, 2026-09-24 (roadmap task 5.6).

This page covers what the copilot needs in order to run, what it costs, and what
to check when it misbehaves. Other docs hold the rest:

- **Decisions:** [ADR 0003](../adr/0003-agent-copilot.md).
- **Plan:** [`integration-plan.md`](integration-plan.md).
- **Tasks:** [`roadmap.md`](roadmap.md).
- **Tools:** [`tools.md`](tools.md), one row per tool.
- **Writing rules:** [`craft.md`](craft.md).
- **The worker, in depth:** [`worker.md`](worker.md).

## What runs where

| Piece | Runs in | Needs |
| --- | --- | --- |
| The panel, interactive turns (`POST /api/assistant`) | the web app | `ANTHROPIC_API_KEY` |
| Proposals, apply, undo, run history | the web app | the database |
| Background runs, `story_to_script` | the worker (`agent_run` jobs) | `ANTHROPIC_API_KEY` **on the worker** |
| `script_to_production` | the worker (`agent_run` jobs) | no model key of its own; its images and shoots need what Production needs |
| Production generations, character looks, location plates, Storyboard frames | the worker (`production_generation`, `frame_generation`) | `GEMINI_API_KEY` and the `R2_*` block |
| PDF export | the web app (and `export_script`) | `apps/web/assets/fonts/` present on the server |
| Evals (`pnpm eval`, `pnpm eval:limits`) | your machine, on demand | the database, `ANTHROPIC_API_KEY`, `EVAL_USER_EMAIL` |

## Environment variables

Every app variable is parsed once, in `packages/db/src/env.ts`, and listed in
[`.env.example`](../../.env.example).

| Variable | Web | Worker | What for |
| --- | --- | --- | --- |
| `DATABASE_URL_SESSION` | yes | **yes** | The worker's claim, `LISTEN` and every job. Must be the session pooler (port 5432). |
| `DATABASE_URL_TRANSACTION` | yes | parsed | Web requests. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | parsed | Server-side data access. Never in the browser. |
| `ANTHROPIC_API_KEY` | for the panel | for background runs | Without it the composer is disabled with the reason, and a background run fails at once. **Set it on both, or neither.** |
| `GEMINI_API_KEY` | for the buttons | for generations | Without it every generate button and paid tool refuses with the reason. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | yes | yes | Portraits, photos, generated images and clips. |
| `WORKER_CONCURRENCY` | - | optional, default 4 | Jobs one worker runs at once (1-32). |
| `WORKER_HEALTH_PORT` | - | optional, default 8080 | `GET /health`. |
| `R2_SWEEP_DELETE` | - | optional, default off | `true` lets the sweeper delete unreferenced Production objects. |

Three test-runner variables are read only by their configs, not by the app:

- `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_PORT`: the Playwright walks.
- `EVAL_USER_EMAIL`: the account the evals' scratch projects belong to.
- `EVAL_STORIES`: which fixtures to run.

## Deploying the worker

The worker is a separate, long-running container. See
[`worker.md`](worker.md) for the build, run and deploy steps. In short:

1. Apply the migrations first. `0034`-`0039` are the copilot's:
   - `0039`: the production pipeline's stages and the location plate.
   - `0038`: the story stages.
   - `0037`: the background run's input.
   - `0036`: the queue columns and their `NOTIFY` trigger.
   - `0035`: the proposals.
   - `0034`: the run records.

   Check with `pnpm --filter @folio/db db:check`, then migrate staging before
   production.
2. Build the image from the repository root (`apps/worker/Dockerfile`) and run
   it with the variables above. Point `DATABASE_URL_SESSION` at the same
   database as the web app.
3. Check `GET /health`. It returns `200` with the database answering.
4. One worker is enough to start with. More replicas are safe, because claims
   use `SKIP LOCKED`. Raise `WORKER_CONCURRENCY` before adding replicas.

Nothing in the web app's hosting changes (ADR 0003 D5). Until a worker is
running, background runs, generations and frames stay `queued`, with their
credits held and Cancel live.

## Costs

**Conversation is free** (D3). No credit is charged for a turn or a background
run. Tokens are recorded on each run (`agent_runs`) and capped per person per
day, at `DAILY_TOKENS_PER_USER` = 2,000,000 (`apps/web/lib/agent/limits.ts`).

**Generations cost credits**, priced in `GENERATION_COSTS`
(`packages/contracts/src/production.ts`):

| Job | Credits |
| --- | --- |
| Storyboard sheet | 40 |
| Scene image | 40 |
| Character look | 40 |
| Location plate | 40 *(provisional: the client has not ruled the price yet; open decision 14)* |
| Frame | 4 each |
| Shoot a reel | 375 |
| AI shotlist, rule-based shots | 0 |

**Every paid step asks first.** A paid tool prices its call. The card shows the
cost and the current balance, and it cannot be confirmed when the balance is
short. Confirming grants the run exactly that budget, since a run starts at 0.
Each image or shoot spends from that grant before it starts, and gives back
what never started. The production pipeline asks twice: once for the images,
then separately for the shoots.

**Limits** (D14, Postgres-backed, fixed windows):

- 60 assistant requests per person per project per hour;
- 30 generate actions per person per project per hour;
- two live background runs per project;
- 12 steps and 60 seconds per interactive turn;
- 40 steps per background job, after which the run waits for a reply.

On 2026-09-24 `pnpm eval:limits` fired concurrent requests at each limit
against the dev database, and each let through exactly its limit:

- 60 of 100 assistant requests;
- 30 of 45 generate actions;
- 2 of 6 simultaneous background-run starts;
- 10 of 20 40-credit spends against a 400-credit grant (the budget CHECK held);
- all 20 concurrent token increments landed on the meter.

## Troubleshooting

| What you see | Why | What to do |
| --- | --- | --- |
| The composer is disabled: "The assistant is not connected" | No `ANTHROPIC_API_KEY` on the web app | Set it and restart. |
| A background run stays `queued` | No worker is running, or it points at a different database | Start the worker. Check `/health` and that `DATABASE_URL_SESSION` is the same database. |
| A run fails: "The assistant is not connected on the worker" | The key is on the web app but not the worker | Set `ANTHROPIC_API_KEY` on the worker. |
| A run fails: "Interrupted: the run stopped three times without finishing" | The worker died or lost its lease three times in a row | Check the worker's logs. Nothing the run proposed is lost; start it again. |
| A checkpoint won't move on after a reply | Checkpoints move only through **Approve** on the run card. Words ask the stage again. | Press Approve. |
| A proposal goes **stale** | The script changed after it was planned (D10's compare-and-swap) | Ask again; it is re-planned on the new script. |
| Generate buttons and paid tools refuse: "The model is not connected: set GEMINI_API_KEY" / "Image storage is not set up on this server yet" | No `GEMINI_API_KEY`, or no `R2_*` block | Set both, on the web app and the worker. |
| A paid card's **Confirm** is disabled | The balance is below the cost | Add credits, or ask for less. |
| "It is past the credits you confirmed for this run" | The run tried to spend more than its confirmation granted | Working as designed (D3). Confirm a new proposal for the rest. |
| "That is 30 generations on this project in an hour, which is the limit" | The D14 limit | Wait for the time it names. The production pipeline proposes what is still missing on its next round. |
| A generation stays `queued` | No worker | Start the worker. Cancel releases the held credits. |
| A location has no plate, so its reels can't shoot | Shooting needs the location's photo | Upload one in Locations, or Approve at the pipeline's plates checkpoint to have one drawn. |
| PDF export: "The PDF fonts are not on this server" | `apps/web/assets/fonts/` is missing from the deployment | Ship the folder with the app. The worker image does not carry it, so a background run's `export_script` cannot draw a PDF. |
| PDF export refuses the Asian format | Its sheet width is open decision 8 | Rule the width, then the engine will measure it. |
| `pnpm eval` stops: "The evals need ANTHROPIC_API_KEY and EVAL_USER_EMAIL" | Missing environment | See `apps/web/evals/README.md`. |
| Playwright walks all skip | No `E2E_EMAIL` / `E2E_PASSWORD` | Set them, and point `E2E_PORT` at a running dev server. |

## Known limits

- **The daily token cap is checked per turn**, from what was left when the turn
  began. Several turns running at once can each spend up to that remainder, so
  the cap can be overshot by the turns in flight. The rate limit of 60 turns an
  hour bounds how far.
- **One images round is cut by the 30-an-hour limit** when an episode needs
  more than 30 generate actions. Whatever didn't start is proposed again on the
  pipeline's next round, once the hour allows.
- **The location plate's price is provisional**, at 40 credits, until the
  client rules it.
