# Development

## Prerequisites

- Node.js 26 or newer (`engines.node` in the root `package.json`) and npm (the repo uses npm workspaces).
- Git.
- For end-to-end tests and Lighthouse: Playwright's Chromium (`npx playwright install chromium`, run in `apps/web`).
- Optional, for real EVE SSO logins: an EVE developer application (see below).

No Cloudflare account is needed locally: `wrangler` and the SvelteKit dev server emulate D1, KV, R2, Workflows and the service binding.

```bash
npm ci
```

`.npmrc` sets `legacy-peer-deps=true`; keep it.

## Local secrets (`.dev.vars`)

Each app reads its local vars and secrets from a gitignored `.dev.vars`. Create both from the examples:

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/updater/.dev.vars.example apps/updater/.dev.vars
```

`apps/web/.dev.vars`:

| Name                    | Value                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `EVE_SSO_CLIENT_ID`     | Client id of your dev SSO application, or empty                                                  |
| `EVE_SSO_CLIENT_SECRET` | Its secret, or empty                                                                             |
| `EVE_SSO_CALLBACK_URL`  | `http://localhost:5173/auth/callback` (must equal the application's callback URL, port included) |
| `SESSION_SECRET`        | base64 of at least 32 random bytes (signs the login state cookie)                                |
| `TOKEN_ENCRYPTION_KEY`  | base64 of exactly 32 bytes; keep the example's dev key so the seed accounts' token decrypts      |
| `ADMIN_CHARACTER_IDS`   | `90000001` (the seed's "Seed Pilot")                                                             |
| `DEV_LOGIN`             | `1` (enables `/auth/dev-login`)                                                                  |
| `USER_AGENT_URL`        | Optional: URL sent in the outgoing User-Agent (overrides the empty `wrangler.jsonc` var)         |
| `USER_AGENT_CONTACT`    | Optional: your contact for the User-Agent, e.g. `mail:you@example.com; discord:name`             |

`apps/updater/.dev.vars`: `EVE_SSO_CLIENT_ID`, `EVE_SSO_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`, with the same values as the web app (needed to refresh structure-market tokens). `EVE_SSO_CLIENT_ID` there overrides the empty var in `apps/updater/wrangler.jsonc`; the optional `USER_AGENT_URL` and `USER_AGENT_CONTACT` work the same way. With both empty, outgoing requests send just `EVE-Reactions-Calculator/<version>`.

Generate a `SESSION_SECRET`:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
```

Never commit `.dev.vars`.

### EVE SSO application for local login (optional)

Without one, use `/auth/dev-login` (below) and leave the SSO values empty; `/auth/login` then shows a 503 page.

1. Open <https://developers.eveonline.com/applications> and create an application of type "Authentication & API Access".
2. Callback URL: `http://localhost:5173/auth/callback`.
3. Scopes: every scope of `ALL_ESI_SCOPES` in `packages/eve/src/scopes.ts` (sixteen; the features on `/account` fail at EVE's login page when the app lacks one of their scopes, so an older dev app must add the profit tracking scopes `esi-wallet.read_corporation_wallets.v1`, `esi-contracts.read_character_contracts.v1`, `esi-contracts.read_corporation_contracts.v1`, `esi-markets.read_character_orders.v1`, `esi-markets.read_corporation_orders.v1`, `esi-characters.read_blueprints.v1` and `esi-corporations.read_blueprints.v1`):
   - `esi-assets.read_assets.v1`
   - `esi-assets.read_corporation_assets.v1`
   - `esi-characters.read_blueprints.v1`
   - `esi-contracts.read_character_contracts.v1`
   - `esi-contracts.read_corporation_contracts.v1`
   - `esi-corporations.read_blueprints.v1`
   - `esi-corporations.read_divisions.v1`
   - `esi-industry.read_character_jobs.v1`
   - `esi-industry.read_corporation_jobs.v1`
   - `esi-markets.read_character_orders.v1`
   - `esi-markets.read_corporation_orders.v1`
   - `esi-markets.structure_markets.v1`
   - `esi-search.search_structures.v1`
   - `esi-universe.read_structures.v1`
   - `esi-wallet.read_character_wallet.v1`
   - `esi-wallet.read_corporation_wallets.v1`
4. Copy the client id and secret into both `apps/web/.dev.vars` and `apps/updater/.dev.vars`.

## Local state (`.wrangler/state`)

Both workers and the SvelteKit dev server share one local state directory, `.wrangler/state` at the repo root:

- `wrangler` commands use `--persist-to ../../.wrangler/state` (wrangler appends `v3`).
- `vite dev` reads `../../.wrangler/state/v3` through `platformProxy` in `apps/web/svelte.config.js`; `WRANGLER_PERSIST=<path>/v3` points it at another state, for example a copy of `.wrangler/state` to experiment without touching yours.
- `npm run e2e:server` (and `npm run test:e2e`) builds with a generated `apps/web/wrangler.e2e.jsonc` (`WRANGLER_CONFIG`): output in `.svelte-kit/cloudflare-e2e`, so a running `npm run dev` cannot block the build, and the `UPDATER` binding pointing at `reactions-updater-e2e`, so e2e admin actions never reach your local updater. To try admin jobs on the e2e state, start an updater under that name: `cd apps/updater && npx wrangler dev --name reactions-updater-e2e --port 8791 --persist-to ../../.wrangler/e2e`.

This directory holds your local D1 databases, KV and R2 data, including whatever live data the local updater fetched. Treat it as yours: nothing in the test suite touches it (end-to-end tests use `.wrangler/e2e`).

Apply migrations without seeding:

```bash
npm run db:migrate:local
```

## Seeding (separate state)

```bash
npm run seed:local                       # writes .wrangler/seeded
npm run dev:seeded -- --port 5180        # web dev server on the seeded state
```

The seed never touches `.wrangler/state`, which holds your real local data (live ESI, SDE and market history fetched by the local updater); `seedLocal` refuses that folder. It writes `.wrangler/seeded`: it applies the migrations, then replaces there KV `dataset:v1` and `market:v1`; the reference tables (`types`, `regions`, `systems`, reactions); latest prices, adjusted prices, cost indices and market stats; every history table (synthetic market from `mulberry32(42)`: 10 days of snapshots and daily prices, 400 days of ESI history); all `job_runs`; the seed accounts and structure hubs without links; NPC hubs return to their migration state. `npm run dev:seeded` starts `vite dev` with `WRANGLER_PERSIST` pointing at it and a generated `apps/web/wrangler.seeded.jsonc` whose `UPDATER` binding is `reactions-updater-seeded`, so its actions never reach your own updater (extra arguments go to `vite dev`). An updater on the seeded state, from `apps/updater`: `npx wrangler dev --name reactions-updater-seeded --test-scheduled --port 8792 --persist-to ../../.wrangler/seeded`. The e2e server seeds its own `.wrangler/e2e`.

The seed contains the SDE fixture (`packages/sde/test/fixtures/sde-mini.zip`, 119 reactions) and two accounts. The fixture is built from an unpacked SDE in `references/sde/` (with `dogmaEffects.jsonl`) and the Hoboleaks fixtures in `packages/sde/test/fixtures/hoboleaks/`; rebuild it with `node scripts/make-sde-fixture.ts [sdeDir] [outFile]` (defaults: `references/sde/` and `packages/sde/test/fixtures/sde-mini.zip`).

The accounts:

| Account       | Character                     | Structure hub                                                  |
| ------------- | ----------------------------- | -------------------------------------------------------------- |
| `seed-user`   | 90000001 "Seed Pilot" (admin) | `structure-1044752365771` "Seed Market", private (Perimeter)   |
| `seed-user-2` | 90000002 "Seed Pilot Two"     | `structure-1042508032148` "Seed Shared Market", pending review |

The seed pilots' refresh token is a dummy encrypted with the dev `TOKEN_ENCRYPTION_KEY`; a price refresh marks it invalid (expected).

`seed-user` also has profit tracking on its personal connection (Profit tracking on, every stream `ok`, `SEED_TRACKING` in `scripts/seed-local.ts`): two contract purchases of raw inputs (one split by a stored Janice appraisal linked in its title, one by the contract price rule), market buys through buy orders with broker fee rows, the two intermediate jobs and a Titanium Carbide job that uses them, a partial sale through a sell order with journal sales tax and broker fee, a delivered manufacturing job (Spike S Blueprint, blueprint ME 10) that takes part of the Titanium Carbide, and one purchase entered by hand (`manual_entries`). The seed also writes the ledger results the updater's rebuild computes from these rows (same `ledger-rows.ts` mapping and `runLedger`), so the data is complete without a running updater.

## Running locally

Web app (Vite dev server on <http://localhost:5173>):

```bash
npm run dev -w apps/web
```

Updater (`wrangler dev --test-scheduled` on <http://localhost:8787>):

```bash
npm run dev -w apps/updater
```

`wrangler dev` never fires cron triggers by itself. To run the schedule locally, start the dev cron next to the updater; it calls `/cdn-cgi/local/scheduled` at start and on every 10-minute boundary:

```bash
npm run dev:cron -w apps/updater
```

The updater fetches live ESI, Fuzzwork, SDE and market.coalition.space data into `.wrangler/state`. `GET /` on the updater answers 500 "no fetch() handler"; that is expected.

The admin buttons and hub changes call the updater through the `UPDATER` service binding; without a running updater `/admin` shows "the updater worker did not answer".

Production build served by `wrangler dev` on <http://localhost:8788> (same `.wrangler/state`):

```bash
npm run build -w apps/web
npm run serve:build -w apps/web
```

### Dev login

With `DEV_LOGIN=1`, log in as any character id without EVE SSO:

```
http://localhost:5173/auth/dev-login?characterId=90000001&name=Seed%20Pilot
```

Optional parameters: `purpose=add_character` (attach to the current account) and `returnTo=/path`. Character 90000001 is an admin with the example `.dev.vars`, so `/admin` and `/admin/hubs` open. The route answers 404 unless `DEV_LOGIN` is `1`; never set it in production.

### Profit tracking locally

1. The dev SSO application needs the profit tracking scopes (listed above); grant Profit tracking (or Corporation profit tracking) to a character on `/account`. A character granted it before the blueprint scopes existed must grant it again (the feature needs every scope).
2. Turn tracking on for its connection. Until the switch on `/account/connections` ships (B25), set it in SQL, from `apps/web`:

   ```bash
   npx wrangler d1 execute DB --local --persist-to ../../.wrangler/state --command "UPDATE inventory_sources SET tracking_enabled = 1 WHERE source_id = <id>"
   ```

3. With the updater dev server running (`npm run dev -w apps/updater`), run a tracking pass (cron step 8 runs on every tick):

   ```bash
   curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"
   ```

   The pass starts a `reactions-tracking-sync` instance per due connection; its steps log as `[tracking-<sourceId>-<ms>] step n/total …`. A connection whose streams are still fresh is skipped until their ESI `Expires`, and the cron syncs a connection at most once an hour (`TRACKING_MIN_INTERVAL_MINUTES`).

`JANICE_API_KEY` in `apps/updater/.dev.vars` is optional: without it the `janice` step is skipped and contracts are split by the contract price rule.

`RYBBIT_SITE_ID=` (empty, as in the example) must stay in `apps/updater/.dev.vars`: `apps/updater/wrangler.jsonc` sets the production site id `"1"`, and without the empty override a local updater would send local accounts' corporation and alliance traits to the production Rybbit.

## Common commands

| Command                                         | Purpose                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run lint`                                  | ESLint and `prettier --check .`                                              |
| `npm run format`                                | `prettier --write .`                                                         |
| `npm run check`                                 | Type checks of every workspace (svelte-check for the web app) and `scripts/` |
| `npm test`                                      | All vitest projects                                                          |
| `npx vitest run --project <name>`               | One project                                                                  |
| `npm run build -w apps/web`                     | Production build of the web app                                              |
| `npx wrangler deploy --dry-run` (in an app dir) | Validates a worker's bundle and bindings                                     |
| `npm run db:generate`                           | Generates migrations from the Drizzle schemas                                |
| `npm run types -w apps/web` / `-w apps/updater` | Regenerates `src/worker-configuration.d.ts` from `wrangler.jsonc`            |
| `npm run check:legacy -- <baseUrl>`             | Requests every v2 URL of every reaction on a deployed site (see deploy.md)   |

Regenerate `worker-configuration.d.ts` without a `.dev.vars` file present and without build output, otherwise local values and build artefacts leak into the types. The updater's `types` script passes `--strict-vars=false`, so vars are typed `string` (`.dev.vars` can override any of them). For `apps/web`, then delete the generated `interface GlobalProps { mainModule: typeof import("../.svelte-kit/cloudflare/_worker") }` block: it pulls the build output into `svelte-check`, which then fails. `wrangler types --check` therefore reports the web file as out of date; nothing runs it.

## Tests

### Vitest projects

| Project          | Location                           | Runtime                                       |
| ---------------- | ---------------------------------- | --------------------------------------------- |
| `engine`         | `packages/engine/test`             | Node                                          |
| `sde`            | `packages/sde/test`                | Node                                          |
| `db`             | `packages/db/test`                 | Workers runtime (`@cloudflare/vitest-plugin`) |
| `eve`            | `packages/eve/test`                | Node                                          |
| `updater`        | `apps/updater/test`                | Workers runtime                               |
| `web-unit`       | `apps/web/src/**/*.test.ts`        | Node, D1 faked with `node:sqlite`             |
| `web-components` | `apps/web/src/**/*.svelte.test.ts` | jsdom                                         |
| `scripts`        | `scripts/test`                     | Node                                          |

Tests never call live ESI, Fuzzwork or the SDE; they use injected fakes and fixtures. `npm test` runs `svelte-kit sync` first (`pretest`). The `sde` project has an optional full-SDE test: set `SDE_DIR` to an unpacked SDE directory. The `scripts` project also checks both `wrangler.jsonc` files (`scripts/test/wrangler-config.test.ts`); `CHECK_PROD_IDS=1` adds the production checks used before deploying (see [deploy.md](deploy.md)).

### End-to-end (Playwright)

```bash
npm run test:e2e
```

Playwright starts `npm run e2e:server` (`scripts/e2e-server.ts`): it deletes and seeds `.wrangler/e2e`, builds the web app and serves it with `wrangler dev` on port 8790 with test-only vars (`DEV_LOGIN=1`, admin 90000001, the dev token key). Your `.wrangler/state` is never touched. Port 8790 must be free. `E2E_REUSE=1` reuses a server already running on that port.

Specs tagged `@smoke` are read-only and can run against a deployed site:

```bash
cd apps/web
BASE_URL=https://preview.reactions.coalition.space npx playwright test --grep "@smoke"
```

### Lighthouse CI

```bash
npm run lhci
```

Audits `/` and `/composite` (mobile, 3 runs each) on the e2e server; assertions: performance at least 0.9, accessibility at least 0.9, SEO at least 0.95. Reports land in `apps/web/.lighthouseci`. With `BASE_URL` set it audits that site instead.

### CI

`.github/workflows/ci.yml` runs lint, check, tests, the web build and both dry-run deploys, then a second job with Playwright and LHCI.

## Windows notes

- A stale `apps/web/.svelte-kit/cloudflare` can make `vite build` fail with `EPERM`. Delete the folder and build again (the e2e server does this itself). A running `npm run dev` may hold the folder open; stop it first.
- PowerShell treats a leading `@` as splatting: quote it, as in `--grep "@smoke"`.
- Setting an environment variable for one command differs from bash. PowerShell: `$env:BASE_URL = 'https://...'; npx playwright test --grep "@smoke"`, then `Remove-Item Env:BASE_URL`.
