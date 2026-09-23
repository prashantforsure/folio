# The worker

**Status:** built in roadmap task 4.1, 2026-09-23. Decisions: ADR 0003 **D5**
(long work runs in a separate process with its own image) and **D6** (the queue
is the Postgres `jobs` table - no Redis, no BullMQ; AGENTS.md ruling R6).

`apps/worker` is a long-running Node process. It claims rows from the `jobs`
table and runs them: Production generations, Storyboard frames and background
agent runs (the handlers are web's, `apps/web/lib/worker/`). The web app does not
change host; the worker is one more container beside it.

## How it works

| Piece | What it does |
| --- | --- |
| Claim | `SELECT … FOR UPDATE SKIP LOCKED` inside one `UPDATE`, oldest first, as many as there are free slots (`WORKER_CONCURRENCY`) |
| Wake-up | `LISTEN folio_jobs` over the **session pooler**; `0036`'s triggers `NOTIFY` whenever a row becomes `queued`. A 5-second poll covers a notification lost to a reconnect |
| Heartbeat | every 15 s, one statement for every held job; it also returns `cancel_requested_at`, so a cancel reaches a running job within 15 s |
| Stale recovery | every 30 s, any worker's sweep: a job with no heartbeat for 2 minutes goes back to the queue; at its **third** attempt it is failed and its kind settles what it held |
| Lease | a claim stamps `claimed_at`; heartbeats and finishes name it, so a worker whose job was taken over cannot settle it |
| Shutdown | `SIGTERM`: stop claiming, let running jobs finish for 25 s, abort the rest, give them 5 s, and put them back in the queue with the attempt given back |
| Health | `GET /health` on `WORKER_HEALTH_PORT`: `200` while running with the database answering, `503` otherwise, the status as JSON either way |

Logs are one JSON object per line on stdout (`event` first). There is no pino and
no Sentry yet (AGENTS.md, Tech stack: planned).

## What it runs

| Kind or clock | Handler | What it does |
| --- | --- | --- |
| `production_generation` | `apps/web/lib/worker/production-generation.ts` | queued by `createGeneration` in the statement that reserves the credits (task 4.3). Runs the spec the row stored with the runner (`pipeline/runner.ts`); the job's ending is read off the generation. Only a writer's cancel aborts the provider call - a shutdown or a lost lease leaves it for the next claim. Abandoned at the third attempt: the generation fails as "interrupted", credits released |
| `frame_generation` | `apps/web/lib/worker/frame-generation.ts` | a Storyboard frame (task 4.3), queued by `requestFrame`. Draws with the `shot_frame` model, stores under `projects/<id>/shots/<shot>/`, settles: drawn = spend, failed = spend + refund, refused or cancelled = release. A job whose shot is gone fails and refunds |
| reaper, every 10 min | `apps/web/lib/worker/reaper.ts` | closes reservations nothing else will (`listOrphanedReservations`): a generation still live with no live job is failed as "interrupted"; a reservation whose owner is over or gone is released under `release:job:<id>`. One with no job id is only logged (`folio.reaper.unkeyed_reservation`) |
| R2 sweeper, every 6 h | `apps/web/lib/worker/sweeper.ts` | lists `projects/*/production/` objects older than a day and logs the ones no row points at (`folio.sweeper.unreferenced`). Deletes them - the asset rows first, then only the objects whose rows went - **only** with `R2_SWEEP_DELETE=true`. At most 10,000 objects a sweep; the next carries on after the last key |
| `agent_run` | task 4.4 | not yet: stays queued |

The worker claims only the kinds with a handler, so a queued job of any other kind
waits rather than fails.

## Environment

Everything goes through `packages/db/src/env.ts`, like the web app's. The worker
needs the same server block as web, because `env.ts` parses it whole:

| Variable | Needed | What for |
| --- | --- | --- |
| `DATABASE_URL_SESSION` | **yes** | the claim, the heartbeat, `LISTEN`, and every job's own reads and writes. **Must be the session pooler** (port 5432) - `LISTEN` does not work over the transaction pooler |
| `DATABASE_URL_TRANSACTION` | yes (parsed) | not used by the worker, but `env.ts` requires it |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (parsed) | not used by the worker, but `env.ts` requires it |
| `WORKER_CONCURRENCY` | no, default `4` | jobs one process runs at once, 1-32 |
| `WORKER_HEALTH_PORT` | no, default `8080` | the port `GET /health` answers on |
| `GEMINI_API_KEY` | for generations | Production generations and Storyboard frames (task 4.3). Without it a job fails with the model-not-connected reason and its credits come back - but the web app draws the buttons disabled then, so none is queued |
| `R2_*` (all five) | for generations | where generated images and clips are stored, and what the sweeper lists (task 4.3) |
| `R2_SWEEP_DELETE` | no, default `false` | `true` lets the sweeper delete unreferenced Production objects older than a day; anything else only logs them. Leave it off until a few sweeps' logs have been read |
| `ANTHROPIC_API_KEY` | for agent runs | background runs and the story pipeline (tasks 4.4, 4.5) |

The worker reads `.env` from its working directory if one is there
(`process.loadEnvFile`), and otherwise takes the environment it is given - which
is what a container host does. **No `.env` enters the image**: `.dockerignore`
excludes every one.

## Run it locally

```bash
pnpm --filter worker build          # bundles src/main.ts and the web handlers into dist/main.mjs
node --env-file=apps/web/.env apps/worker/dist/main.mjs
curl localhost:8080/health
```

Run it with Node 22.12 or later, like web. Migration `0036` must be applied to
the database it points at: without it the claim fails on the missing columns,
`/health` turns `503`, and nothing is written.

## Deploy to a container host

The image is built from the **repository root**, because the worker bundles four
workspace packages and web's handlers:

```bash
docker build -f apps/worker/Dockerfile -t folio-worker .
docker run --env-file <your env file> -p 8080:8080 --stop-timeout 40 folio-worker
```

On any container host that runs an always-on container (Fly, Railway, Render,
ECS, a VM with Docker):

1. **Apply the migrations first.** `0036` (the queue columns and the `NOTIFY`
   trigger) must be on the database before the first worker starts - and, for
   the handlers, the migrations of the tasks that add them. Apply to staging
   before production, as every migration here. Before the first start against a
   database with old data, look at `select kind, status, count(*) from jobs group
   by 1, 2`: every `queued` row of a handled kind is claimed at once (dev holds 13
   frame jobs queued since 2026-09-11; they fail and refund if their shots are gone,
   and draw - spending a model call - if not).
2. **Build the image** from the repository root with the command above, or
   point the host's builder at `apps/worker/Dockerfile` with the root as the
   build context.
3. **Set the environment** from the table above. `DATABASE_URL_SESSION` must be
   the session pooler.
4. **Health check:** `GET /health` on `WORKER_HEALTH_PORT` (the image declares a
   `HEALTHCHECK` too). No inbound traffic is needed otherwise - the worker
   serves nothing but this.
5. **Stop timeout of at least 35 seconds** before the host sends `SIGKILL`: the
   drain is 25 s plus 5 s for an aborted job to notice. A shorter one only
   means unfinished jobs are recovered by the stale sweep two minutes later,
   rather than handed back at once.
6. **Instances:** any number. Claims skip each other's rows, and any worker's
   stale sweep recovers a crashed worker's jobs. Mind the pooler's connection
   limit: each worker holds up to ten session connections plus one for `LISTEN`.
7. **Always on.** The worker is a long-running process, never a serverless
   function (AGENTS.md, Deliberately not using): scale-to-zero means nothing
   claims the queue until something wakes the container.

## What it deliberately is not

No Redis, no BullMQ, no second queue - the `jobs` row is the only record of a
job (D6). No retries with backoff beyond the three attempts. No notification when
a job finishes: job completion is in-app only (AGENTS.md, Constraints).
