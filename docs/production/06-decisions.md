# 06 — Decisions: rulings, assumptions, escalations, and the session log

Every session reads §1–§3 first and appends to §4 last. A ruling is the product owner's; an
assumption is ours and is flagged until confirmed; an escalation is a question the contract says
we may not answer (`AGENTS.md`, "When to ask first").

## 1. Rulings taken (the product owner)

| # | Date | Ruling |
|---|---|---|
| R-1 | 2026-09-18 | **The pipeline lives inside script projects** as the episode-scoped `/production` route. No Cinema-style script-less project type; that would need the `/app/filmmaking` ADR (open decision 9) and break "the screenplay is the source of truth". |
| R-2 | 2026-09-18 | **The plan includes a real worker and one provider** — `apps/worker` on BullMQ + Redis as `AGENTS.md`'s Architecture names it, and one aggregator (fal.ai) so image and video are one integration. Each dependency is still approved on its own. |
| R-3 | 2026-09-19 | **Laper's live Production workflow is the target shape** — scene tabs from the headings → a reel strip per scene → a reel canvas of cards (the user's screenshot), with Folio's derived Performance card. *Recorded from "they have amazing workflow… we can also create AI video with all the consistent character"; the body shape itself was not answered as a multiple choice, so R-3 is a ruling by intent — confirm at the design review (Phase D).* |
| R-4 | 2026-09-19 | **Documentation before code, mockups before frontend.** This doc set is written first; Claude Design frames from [02-design-spec.md](02-design-spec.md) are approved before any frontend phase; the build is split into phases across sessions. |

## 2. Assumptions (ours; flagged)

| # | Assumption | Where it bites | Confirm by |
|---|---|---|---|
| A-1 | The old `Route - Production v2.dc.html` mockup is retired by [02-design-spec.md](02-design-spec.md) (the precedent: Characters, Locations, Timeline mockups retired for written plans). | Phase 2 replaces the row layout | Phase D review |
| A-2 | Per-shot frames stay (Folio) even though Laper's Cinema reel has one anchor frame per reel — because the kept frames are the clip's first/last-frame inputs. The reel's anchor is shot 1's kept frame. | Phase 1–3 | Phase D (F02) |
| A-3 | The exact-fill timing rule (durations = clip length) stays; Laper enforces the same. | Phase 2 gate | — |
| A-4 | Credits stay per project (the ledger is project-scoped); Laper's are per user. | — | — |
| A-5 | Views `Scene \| Episode` stay `?view=` until the client asks for client state (their repeated ruling on five routes; memory says do not pre-empt). | Phase 2 | the client's ask (D-11) |
| A-6 | The Performance card is read-only; every text edit goes to the Script. | Phase 2 | Phase D (F01) |
| A-7 | Film settings are never locked (Laper locks aspect/camera after the first shoot); stale marking replaces the lock. | Phase 1 | D-10 |
| A-8 | The Extra prompt and Image cards are per reel (`reels.extra_prompt`, `reels.layout`), not per shot. | Phase 2 | Phase D |
| A-9 | The Cast card's `✦ Generate look` on the canvas runs the same job as the Characters drawer's; the canvas is a shortcut, the record is the home. | Phase 2 | — |
| A-10 | Placeholder prices (§ of [04](04-generation-pipeline.md) §8: `CREDIT_USD 0.01`, `MARGIN 2.2`) and the sample costs in the design spec (frame 15, still 15, Look 15, Turnaround 25, plate 15, clip 375) are illustrative until D-4. | every cost label | D-4 |
| A-11 | The market/model facts from the 2026-09-18 web sweep (model names, prices, shutdown dates, reference counts) were **not verified** by a skeptic pass (the workflow hit the session limit). The registry rows are `// VERIFY` until a session checks each on the vendor page. | Phase 1 registry | Phase 1 step 1 |

## 3. Decisions to make (escalations) — with recommendations

| # | Decision | Options | Recommendation | Blocks | Status |
|---|---|---|---|---|---|
| D-1 | Queue | (a) BullMQ + Redis (R-2) · (b) Postgres `FOR UPDATE SKIP LOCKED` polling, no infra | (a) as ruled; the `jobs` row stays the truth and the queue carries only its id; (b) noted as the fallback if Redis is not provisioned | Phase 1 | ruled by R-2 |
| D-2 | Provider | (a) fal.ai over `fetch` · (b) `@fal-ai/client` · (c) vendor-direct SDKs | (a): zero dependency, one key, image + video + lip-sync under one API | Phase 1 | ruled by R-2 (fal); (a) vs (b) open |
| D-3 | Model naming in the product | tiers vs model names | **tiers** `Draft · Standard · Cinema`; the registry maps; nothing else names a model | Phase 1 | recommended |
| D-4 | Credit unit and margin | `1 cr = $0.01` with a margin multiplier vs hand-picked integers per action | `ceil(usd × MARGIN ÷ 0.01)` from the registry; `MARGIN` around 2–2.5; preview.io prices at 100 cr = $1 | Phase 1 (labels), Phase 3 (real money) | **escalate — touches credits** |
| D-5 | Frames per shot + one anchor (Folio) vs one anchor per reel (Laper) | — | per shot; anchor = shot 1's kept frame (A-2) | Phase 1 | recommended |
| D-6 | Clip-length source | keep the `CLIP_SECONDS` CHECK vs registry-driven per tier | registry-driven; drop the CHECK in `0026`; validate in the repository | Phase 3 | **escalate — a dropped constraint** |
| D-7 | Exact-fill rule | keep / relax | keep (A-3) | — | recommended |
| D-8 | Continuity per reel | none vs `natural \| match_last_frame` | add the mode | Phase 2/3 | recommended |
| D-9 | Cancel while running | (a) no refund (Laper) · (b) refund whenever the provider did not bill (fal bills only success) | (b); record `provider_cost_usd`; the button's title says which | Phase 3 | **escalate — refund policy** |
| D-10 | Film-settings shape | `projects.production_settings jsonb` vs four columns | jsonb, validated by `FilmSettingsSchema`; `render_resolution` stays a column | Phase 1 | **escalate — schema** |
| D-11 | `?view=scene\|episode` | keep vs client state | client state, on the client's ask (A-5) | Phase 2 | awaiting the client |
| D-12 | Credits identity | per user (Laper) vs per project (Folio) | per project (A-4) | — | recommended |
| D-13 | Where kept Looks/plates live | `entity_generations` (+ the record's upload key as the "no AI" path) vs a copied key on the record | `entity_generations` | Phase 1 | **escalate — new table** |
| D-14 | Legacy URL columns (`frame_upload_url`, `frame_url`, `clip_url`) | leave vs migrate to keys | new columns store keys; migrate the three in a separate ruled data migration | — | deferred |
| D-15 | Multi-shot render vs chained single clips | one multi-shot job when the tier can; chaining as the fallback | multi-shot in phase 3; chaining (needs ffmpeg) in phase 5 | Phase 3 | recommended |
| D-16 | Card layout storage | `reels.layout jsonb` vs a `reel_cards` table | jsonb (cosmetic, like `canvas_x/y`) | Phase 2 | **escalate — schema** |
| D-17 | Compare modes | split / fade / side-by-side (preview.io) vs side-by-side only | all three (the CSS is small) | Phase 4 | recommended |
| D-18 | Comments on takes | anchor `comment_threads` to a generation id vs no comments on takes | anchor to the generation id (Laper: "supported canvas entities"; preview.io: pins on files) — a `comment_threads` change | Phase 4 | **escalate — table change** |
| D-19 | PDF board engine | the script export's engine vs print CSS | the export engine if reachable from a server action; else print CSS in phase 4 and the engine later | Phase 4 | deferred to phase 4 |
| D-20 | `apps/worker` storage helper | duplicate the 60 lines of `r2.ts` vs a new `packages/storage` | duplicate with a comment until a package is ruled | Phase 1 | recommended |
| D-21 | Assistant writes on this route (model proposals, dispatching jobs) | — | not until open decision 13 and "widen what the AI writes" are ruled; Ask-mode confirmation in chat is the model when they are | Phase 5 | **escalate** |

**AGENTS.md open decisions touched:** 13 (any `✦`'s cost — every button here names one, so the
assistant-cost question becomes urgent once the assistant can spend), 10 (a reel URL waits on the
scene-id ruling; selection stays client state), 9 (not touched by R-1).

## 4. The log (append; newest last)

- **2026-09-18** — Research: all 34 laper.ai docs pages, the feature articles, pricing, legal,
  changelog, `/llms-full.txt`, the app bundle strings; preview.io docs; ~30 tools and ~35 models;
  both repo audits. A 40-agent research workflow completed its read phase and died on the session
  limit before design/verify; the synthesis was done by hand. Rulings R-1, R-2 taken.
- **2026-09-19** — The user's screenshot of Laper's live Script-project Production route (the
  bridge the docs deny) and the ask to explain the consistency mechanics; preview.io read. R-3, R-4
  taken. This doc set written: README, 01–07. Nothing built. The working tree had `docs/ui design/`
  deleted (uncommitted, by another session) — read from git, not restored.
