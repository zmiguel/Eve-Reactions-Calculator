# EVE Reactions Calculator – AI Agent Instructions

## Quick Start
- `npm run dev` runs Vite without Cloudflare bindings; use `npm run dev-local` (Wrangler) when you need live KV/D1 access via `platform.env`.
- `npm run build`, `npm run check`, `npm run lint`, and `npm run format` are the only supported pipelines; keep them green.
- Cloudflare adapter is preconfigured in `svelte.config.js`; env bindings live in `app.d.ts` (`KV_DATA`, `DB`).

## Application Architecture
- Three calculators (`/biochemical`, `/composite`, `/hybrid`) plus `/settings`. Each `+page.server.js` pulls cookies, builds an `options` object, fetches blueprints from KV, calls helpers from `src/lib/server/calc.js`, and returns tabular data for `@vincjo/datatables` tables rendered in `+page.svelte`.
- Defaults are enforced in `src/routes/+layout.server.js` via the shared `setCookie()` helper (`$lib/cookies.js`). Missing cookies get sane starting values so `calc` never receives `undefined`.
- Settings can be “single” or “separate”. When `settingsMode === 'separate'`, cookie names gain suffixes (`input_biochemical`, etc.). `settings/+page.server.js` mirrors the suffix logic through the `getSettings` helper so every load returns a fully hydrated settings object.

## Calculation Engine (`src/lib/server/calc.js`)
- `prep(type, options, blueprints, env)` builds `item_string`s, hydrates SQL templates stored in KV (`query-prices-for-item-at-system`, `query-select-items-by-id`, `query-cost-index-for-system`), and returns `{prices, items, cost_index}` from D1.
- `simple()` applies rig/space/skill bonuses, installation fees, taxes, and broker/sales costs, returning both per-job economics and metadata (`style`, `cycle_data`, `remaining`).
- `chain()` and `fullChain()` recursively call `simple()` to replace purchasable inputs with self-built intermediates, carefully folding in nested taxes and remaining inventory. `refined()` swaps the output into refined breakdowns using both unrefined/refined blueprints.
- All helpers expect the `options` shape emitted by `settings`, they mutate totals heavily, and they run under `Promise.all()` in page loads—preserve return contracts and keep them side-effect free beyond logging.

## Routes, UI, and Styling
- Tables rely on `new TableHandler(data, { rowsPerPage: 50 })` plus the `TH` helper component for sortable headers; row clicks navigate via `data-href` + `goto`.
- Svelte 5 runes (`$props`, `$bindable`, `$effect`) are standard—see `SettingsForm.svelte` for naming helpers (`getName`) and shared AutoComplete inputs backed by `$lib/systems`.
- Styling is global Bootstrap 5; `vite.config.js` autoloads `variables.scss` into every SCSS file, so declare design tokens there instead of per-component styles.

## API Endpoints & Integrations
- `/api/v1/price` directly queries D1 for a specific `item_id`; other `/api/v1/*` handlers (`biochemical`, `composite`, `composite_chain`, `hybrid`) wrap the same calc helpers used by pages for automation/benchmarking.
- Blueprints are read from KV (`bp-bio`, `bp-comp`, `bp-hybrid`). When adding a new reaction type, ensure the worker that seeds KV (see `tools/json`) is updated, otherwise `prep()` will fail to find IDs.
- Platform bindings are available only when running under Wrangler/Workers; when unit-testing helpers locally, stub `{ DB, KV_DATA }` (D1 implements a `prepare().bind().all()` API subset).

## Price Update Worker (`update/`)
- `update/src/index.ts` is a scheduled Cloudflare Worker that refreshes adjusted item prices, blueprint industry cost, system cost indices, and market prices. Queries (`query-items`, `query-update-price`, etc.) live in KV namespaces `DATA` and `ENDPOINTS`.
- The worker streams batches into D1 (`env.DB.batch`) and retries market pulls via `fetchMarketPricesWithRetry`; maintain the strict `userAgent` and logging helpers when adding steps.

## Data & Tooling Notes
- D1’s `prices` table stores `item_id` per system with columns for `sell`/`buy`. System lists come from KV key `systems-for-price-tracking` and are also mirrored in `tools/json` for offline regeneration.
- Legacy CSV/SQLite scripts in `tools/` rely on `better-sqlite3`, `csv-parse`, and `csv-writer` to rebuild blueprint/price payloads; keep them aligned with what the worker expects (field names `_id`, `inputs[{id,qt}]`, etc.).
- When touching calculations or cookie schemas, audit all three calculators, the API routes, and the worker to keep option names, blueprint filters, and KV keys in sync.
