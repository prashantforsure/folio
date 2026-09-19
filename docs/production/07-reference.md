# 07 — Reference: what laper.ai and preview.io do (so no session re-researches)

Collected 2026-09-18/19 from laper.ai's docs (all 34 pages, verbatim via `/llms-full.txt`), its
`/features/` articles, pricing, legal, changelog, the marketing bundle's i18n string tables, the
user's screenshot of the live app, and preview.io's docs. Quotes are verbatim. "Bundle" means the
string appears in Laper's app bundle but on no docs page.

## 1. Laper — the shape of the product

Two project types on one workspace: a **Script project** (screenplay, outline, beats, derived
scenes, characters, locations, props, shots, references, collaboration) and a **Cinema project**
("turning short dramatic units into visual production pipelines: scene design, performance, shot
design, storyboard images, and finished clips"). "Their creative data models remain separate, so a
Cinema reel is not secretly a screenplay scene and a screenplay scene is not a video task."
Screenplay text, outline, beats, scenes and shots belong to an **episode**; characters, locations,
props, worldview, knowledge and advisors are **project-wide**. "The screenplay is the source of
truth… write facts at their source, use derived views to inspect them, and use AI with a clear
target and scope."

## 2. The live Script-project Production route (screenshot, 2026-09-19)

Undocumented (the docs, regenerated 2026-09-17, still say "Cinema does not import FDX" and "a reel
is not a screenplay scene"), but shipped:

- Header `Ep 1 ▾ · Production 5 · + Add Reel`.
- **Scene tabs from the headings**: `1. INT/EXT ROOFTOP COURT - NIGHT` … `5. INT ROOFTOP COURT -
  NIGHT`; the active tab has a page icon and a wand icon. Bundle: "Production reels are arranged by
  scene. Write scene headings in the Script first and reel rows will appear here automatically";
  `Auto-assign reels`; a scene card's `Go to Production`; a migration seed name `EP{{ep}} — {{label}}`.
- **Reel strip** per scene: `Reel 1 … Reel 6`, each `Start Shooting` and a `+` to insert.
- **Reel canvas** (node canvas, curved connectors from a source node into the cards):
  - *Storyboard shot card*: `Clip length 5s 8s 10s 15s`; a per-shot coloured timing bar
    (`4s | 3s | 5s | 3s`); shot rows (colour badge, `⏱ 5s`, trash, prose with the camera spec in free
    text — "ARRI Alexa Mini LF, 35mm, T2.0 — ground-level tracking shot moving with her from half
    court. @Tash walks it back…"); footer `15s / 15s`; `AI Storyboard`; the right half = the storyboard
    image with `Finalize Frame`, empty copy "Finish the shot list on the left first, then generate
    the storyboard image. Shots with gore, violence, or sexual content can't be rendered as
    storyboard images."
  - *Scene card* `Rooftop Court`: "Awaiting upload or AI", a description, `Generate Scene`.
  - *Cast card* `Tash`: tabs `Look | Costume`, portrait, `Appearance prompt` ("long silver braid,
    weathered face, compact athletic build, scuffed basketball sneakers"), `Edit character · Upload ·
    Generate`.
  - a plain image card, an `Extra prompt` card, a per-card ask "Tell Laper how to change this card…".
- **Bottom bar**: canvas tools · `Cast` · `Location` · wand · `720p` · `220` credits · "Jot down your
  ideas…" · `Laper AI`.

## 3. Laper docs — production pages (verbatim essentials)

**[storyboard](https://laper.ai/docs/production/storyboard/)** — "Storyboard shots belong to scenes,
and scenes come from screenplay headings." Views: "panel, table, and canvas… the same episode-level
shots in different forms." "The AI assistant is guided to default to roughly three decisive shots and
to reconsider plans that exceed six." "Each shot should express subject, framing, camera position or
movement, action, and dramatic purpose." "Chat writes design; generation is a separate action… Image,
video, and audio outputs run through explicit generation tasks with visible cost, status, retry, and
asset results." "If the screenplay changes, revisit shots in that episode."

**[shot-list](https://laper.ai/docs/production/shot-list/)** — the table view; "checking lens or
framing choices, camera logic, repeated coverage"; review in layers: geography, dramatic ownership,
reveal, continuity, economy; "If you only need analysis, say 'do not edit.'"; "Deleting an asset does
not automatically rewrite the shot plan."

**[ai-assets](https://laper.ai/docs/production/ai-assets/)** — "Laper separates the execution record
from its outputs. A generation task owns status, credit charge, estimated progress, retry behavior,
and failure handling. One task can produce one or more assets." "Before generating, check the
selected episode or entity, reference images, prompt, aspect ratio, and the credit cost shown on the
action." States "queued, generating, completed, or failed… while the backend maintains more detailed
execution states." "Entity-bound workflows can route a result back to a character, prop, shot, or reel
field, while project-level free creation stays in the asset library." Laper Space workflows: poster
and casting images, trailer or scene dramatization video, director roundtables, table reads (bundle:
video "being wired", audio "coming soon").

**[cinema-projects](https://laper.ai/docs/production/cinema-projects/)** — setup: "landscape or
portrait orientation, production type, camera style, and art style." "Cinema does not import FDX."
"Each episode owns its reels. Characters, props, production settings, and the task library are shared
by the project." Dimensions: Reels (board, timeline, list), Characters ("Cinema-specific look
development"), Props, Tasks. "A reel is a compact visual-production unit that passes through scene
design, performance, shot design, storyboard image, and final clip." The Cinema assistant needs "the
target reel and stage".

**[cinema-pipeline](https://laper.ai/docs/production/cinema-pipeline/)** — the five stages: "Scene:
write the environment and add reference images; generate a scene image when ready. Performance: write
the playable dramatic action using @character, #prop, and quoted dialogue. Text storyboard: create and
refine real shot records… Storyboard image: generate a visual anchor from the shot sequence, scene, and
references. Final clip: start production and select among generated video versions." "Scene and
Performance can be developed in parallel. Text storyboard and later stages require their prerequisites
so downstream media does not invent missing structure." "A final Cinema clip is fixed at 15 seconds.
Resolution and production level are film-level settings." "In last-frame continuity mode, the selected
previous reel can provide its final frame as the next reel's opening anchor. Natural transition mode
generates independently. Review costume, props, light, eyeline, and movement yourself." "New
generations create versions. Select the preferred version deliberately and remove obsolete versions
only after review."

**[plans-and-credits](https://laper.ai/docs/account/plans-and-credits/)** — "AI conversation usage
and media-generation credits… are not the same meter." "A task displays cost before dispatch. The
backend owns charging, execution, failure, and refund behavior." "task streams and balances remain
associated with users." No numbers on any page ("use live UI values instead of stale quota tables").

**[ai-storyboarding feature](https://laper.ai/features/ai-storyboarding/)** — task context: "the
selected scene's screenplay text; the selected scene's typed Plate/Loro node slice; character entities
referenced by the scene; existing shots and their stable order; neighboring storyboard images when
continuity requires them; camera settings the user explicitly chose." "Laper tracks whether those
values came from a real user choice. Historical defaults without provenance are not silently injected
into a generation request." "If the previous image is missing, the request is blocked: no task is sent
and no credits are deducted." "Reference slots have an intentional order."

**[ai-production-assets feature](https://laper.ai/features/ai-production-assets/)** — ownership: auth,
credits, lifecycle → API backend; model execution and upload → a generation worker that "does not
authenticate users or write application tables"; realtime "can tell the current user that a task
changed state; it does not decide what the screenplay contains." "The Assets module is not the
universal 'generate' button. Generation starts where the context lives."

**Other docs**: characters are project-wide identities derived from cues, enriched in the
Characters dimension (canvas, network, casting table); locations derive from headings, with a
scouting table and "separate story place from production place"; props are project-level with
canvas + list ("AI prop images are reference assets; verify scale, material, continuity, and rights");
comments are rows outside the CRDT anchored `(dimension, anchor)` to "script text, outline content, or
supported canvas entities" (beats excluded; Viewers can comment); version restore "restores both
screenplay and project entities" (Cinema: "full-document reconciliation"); **export covers Script
(PDF/DOCX/TXT/FDX Hollywood; PDF/DOCX/TXT Asian) and Outline only** — no production export anywhere.

## 4. Laper bundle strings (the UI vocabulary the docs omit)

- **Production Settings modal**: "The art style is a film's visual soul — every scene, storyboard and
  final frame will follow it". Aspect Ratio `Landscape 16:9 | Portrait 9:16` ("runs through the whole
  film once production starts, and can't be changed"); Production Type `Narrative | Commercial`;
  Camera Style `Academy | Handheld`; Art Style (12 presets, "Click a card to select; you can switch
  anytime from the production panel"), Film Resolution `720p (Self-media) | 1080p (Cinema-grade)`;
  Production Quality `Social ("HD") | Theatrical ("the world's most advanced video-generation model")`.
- **Cinema nav**: Production · Characters · Locations · Props · Tasks. **Reel segments**: Pro Canvas ·
  Easy Reel · Canvas · Bus · List · Timeline · Relationships. **Reel table**: Reel · Storyboard Frame ·
  Scene Image · Scene Description · Shots · Duration · Final Cut. **Steps**: Scene · Text Storyboard ·
  Storyboard Frame · Final.
- **Canvas cards**: Plain image · Cast member · Location · Storyboard shot · Extra prompt; "Awaiting
  upload or AI"; `Add shot`, `Remove shot`, `Shot duration (s)`, `Clip length`, "Shots already run
  longer than this — shorten them first"; "Mention a character to direct their performance"; 'Wrap
  character dialogue in "" to highlight'.
- **The gate**: "A few things are missing before you can shoot" — Character card ("Drag the cast onto
  the canvas so the AI knows who is actually in this scene"), Shot card, Scene image ("Without a scene
  image the camera rolls in the dark"), Shot list ("The durations must add up to exactly the reel's
  clip length — not a second more or less"), Storyboard frame ("Lock a storyboard frame first, so the
  footage has a visual reference to match"), Character image ("An actor needs a headshot before
  stepping on set — otherwise the model invents one"; "{{names}} has no character image yet. Without
  one, the same character will look different in every frame").
- **Final**: Continuity `Match cut on last frame | Natural cut`; "Shoot Cost … estimated from current
  resolution, production level and this reel's clip length"; `Start Shooting`, `History ({{count}})`,
  `Switch to this version`, `Delete this version`, `Reshoot`, `Cancel generation` ("Canceling cannot
  refund spent credits"); "Generation failed, credits refunded".
- **Tasks**: statuses Queued · Dispatched · Generating · Done · Failed · Timed out · Cancelled;
  columns Type · Status · Output · Credits · Created; types Character · Costume Look · Scene ·
  Storyboard · Final Cut. **Character look-dev**: Look → three-view Costume sheet; "Upload your own
  portrait (no AI)".
- **Script-project Storyboard fields**: Size `EWS/WS/LS/FS/MS/MCU/CU/ECU`, Angle `Eye/High/Low/Dutch`,
  Movement `Static/Pan/Tilt/Dolly/Tracking/Crane/Handheld`, Lens, Description, Duration, Staging,
  Notes; slate `SCENE / I/E / LOCATION / D/N`; per-shot `Generate` with "Finish the previous shot first".
- **Credits**: per user; buckets promotional → subscription (no rollover) → purchased (never expire);
  plans Junior $0 (10 chats, 10 daily credits) · Senior $20 (500 chats, 600/mo + 20 daily) · Elite $60
  (2,000, 2,800 + 60, high-speed) · Master $100 (unlimited, 6,000 + 100, "no queue") · Legend $400
  (32,000 + 400, dedicated channel). Welcome survey 100 credits. No model is named anywhere public;
  the only LLM ever disclosed was Claude Sonnet 4 (Oct 2025) for chat.

## 5. preview.io ([docs](https://docs.preview.io/llms.txt))

"The production platform for AI video." Credits: "100 credits = $1, and cost varies by model,
resolution, duration, and output count"; no subscription; cost shown live in the prompt box, on model
chips, and confirmed by the agent before it generates.

- **Studio** = an infinite collaborative canvas with a **prompt box** (model chips with resolution and
  duration ranges; image: resolution + aspect; video: duration, audio toggle, start/end frames set from
  the canvas, the library, an upload or a canvas file; seed; output count; negative prompt) and a
  **Next Take box** (where the next generation lands). `@` references: "Recently used, Gen History,
  Uploads, and your library by category (Characters, Locations, Props, including specific variations)";
  each model has reference limits.
- **Sequence Timeline**: rows = sequences of ordered shots; every canvas file has **"Select for"** to
  assign it to a shot; multiple shotlists per project; sequences export to **FCPXML**.
- **Production** view: **Shotlist** (table, show/hide columns, reference images), **Storyboard**
  (grid/rows, drag reorder, cycle alternates), **Kanban** (group by status, priority, assignee, scene,
  character, location; "drag a shot into the next column"); filters; multi-select.
- **Scripts**: block-based (Text, Scene, Dialogue, Parenthetical, Transition), `@` library chips in
  cues and sluglines; import `.fountain/.fdx/.txt` through the agent; "Scripts don't directly link to
  sequences or shots" — the agent is the bridge ("board out scene 3").
- **File View**: Info (shot details; take info; "prompt, model, resolution, Camera Bag settings,
  references, cost, and seed"); **Provenance** ("parent files, model used, and every reference that fed
  the generation"); **Comments** pinned on the file; **Compare** (Split · Fade · Side by side);
  Reuse / Copy prompt / Download / Copy link.
- **Quick Styles & Camera Bag**: saved visual treatments; Camera Bag = "Camera/Film Stock, Lens,
  aperture, and focal length into a custom look"; "prompt for subject and action, references for
  identity or composition, Quick Styles or Camera Bag for repeatable visual language."
- **Preview Agent**: shot lists from the script, coverage, character sheets, storyboards, batched
  generations (up to 8), free transforms; **Ask mode** ("every generation pauses in chat for your
  approval") vs **Auto mode**; generated files are "co-authored, with a link back to the chat";
  it cannot delete.
- Also: Generate World (a navigable 3D set from one reference image; capture camera angles back to
  the canvas), Inpaint, Upscale (Topaz/Magnific), Photoshop and ComfyUI round-trips, History (every
  file restorable), Groups, Tags, Project Analytics (team credit spend), a command palette, CLI/MCP.

## 6. Market patterns (2026-09 sweep; model facts unverified — check the vendor page)

- Every serious tool: shot list before any spend; one image per shot before video; a reference set
  per character/location/prop, `@`-mentionable; takes/versions with an explicit keep; a visible task
  with cost on the button; MP4 + PDF export; per-second, per-model, per-resolution pricing with audio
  as a multiplier.
- The best: **multi-shot in one generation** (Kling 3.0 "Custom Multi-Shot" 2–6 shots ≤ 15 s; Wan 3.0
  "6-shot Director"; Seedance 2.x up to 30 s); take repair not re-roll (LTX Retake, Runway Aleph,
  Seedance local edit, Luma Modify); continuity as a mode (Flow Extend, first+last frames); voice
  bound to the character (Kling Elements voice, ElevenLabs Text-to-Dialogue + Sync lip-sync);
  per-shot model routing with an estimate; NLE handoff (Runway's Premiere panel, FCPXML/AAF).
- Nobody: marks work stale when the script changes; checks continuity automatically; budgets a reel
  at expected takes × cost; names the model or price plainly. **Reference sheets have replaced LoRA.**
- Reference capacity (reported): Seedance 2.5 up to 50 refs; Hailuo H3 9 images + video + audio;
  Kling 3.0 Elements 4 images per subject, 7 per job; Wan 3.0 images + video + audio + a document;
  Vidu 3–7; Veo 3.1 "Ingredients" (count unstated); Luma Ray3 one character ref; Nano-Banana-class
  image editors up to 14 refs; FLUX.2 8–9.
- Pricing shape: credits; cost = seconds × rate(model, resolution, audio) + reference surcharge;
  images flat per image; cost before dispatch; APIs hold against the max duration and release the
  remainder; failures refunded on APIs. Reported ranges: image $0.03–0.13; video $0.05/s (lite) to
  $0.40–0.68/s (top tier with audio). Volatile: several models had announced shutdowns within weeks
  of the sweep — hence the registry.
- The 15-second unit is convergent (Laper fixed 15 s; Kling 3–15; Hailuo 15; Wan 2.6 15; Vidu 16; Veo
  8 + extend; Seedance/Wan 3.0 to 30).
