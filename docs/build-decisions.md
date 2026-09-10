# Build decisions

Running record of decisions that are too small for an ADR but too consequential
to leave in a commit message. ADRs live in [`docs/adr/`](./adr/).

## Pagination: two modes and a cadence flag

Stub. Written out in the phase that builds the pagination engine.

The shape is already fixed by AGENTS.md and is not open for reinterpretation:
pagination is **`pageMode: paged | continuous`** plus **`liveRepaginate: boolean`**
— two rendering modes and a cadence flag, *not* three peer modes. Both live per
project, not in the URL, which is why they appear in the "sub-views are query
params — except" table rather than as a query param.

Also settled, and to be written up here: pagination is computed server-side so
client, print and export agree; results go on a measurement record and never on
a node; `format` is an input to the engine rather than a print preference.

Open, and blocking: **decision 8** in the AGENTS.md open-decisions table — sheet
width for `format: asian`, where A4 is ~794px rather than 816px.

This heading exists so the anchor `#pagination-two-modes-and-a-cadence-flag`
resolves; the route document already links to it.
