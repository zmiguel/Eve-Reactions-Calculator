# Deployment runbook (Cloudflare)

Two stages, in order:

1. **Preview (PLAN B13), steps 0 to 11**: deploy everything and run v3 as a Worker Preview at `https://preview-reactions-web.zmiguel.workers.dev` on live data, while the v2 site keeps serving `reactions.coalition.space`.
2. **Production (PLAN B14), steps 12 to 14**: once the preview is accepted, move `reactions.coalition.space` from v2 to v3.

**Status: both done on 2026-10-08.** The configs in the repo are the post-cutover state: production on `https://reactions.coalition.space`, the preview on `https://preview.reactions.coalition.space`, nothing on `workers.dev`. Steps 0 to 11 describe the first setup as it was run (preview on `workers.dev` because v2 still held the domain); for routine work see [Routine operations](#routine-operations).

Values you must fill in are written as `<FILL: description>`. Commands use bash syntax; on Windows run them in Git Bash or WSL, or see the PowerShell notes where given.

## What gets deployed

| Piece           | Name                                                                                                                                                                                                         | Defined in                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Updater worker  | `reactions-updater` (cron `*/10 * * * *`), production only                                                                                                                                                   | `apps/updater/wrangler.jsonc`       |
| Web worker      | `reactions-web`: production on `reactions.coalition.space`; the Preview `preview` on `https://preview.reactions.coalition.space` (on `https://preview-reactions-web.zmiguel.workers.dev` before the cutover) | `apps/web/wrangler.jsonc`           |
| D1 databases    | `reactions-core` (`DB`), `reactions-history` (`HISTORY_DB`)                                                                                                                                                  | both configs and the web `previews` |
| KV namespace    | `reactions-cache` (`CACHE`)                                                                                                                                                                                  | both configs and the web `previews` |
| R2 bucket       | `reactions-archive` (`ARCHIVE`)                                                                                                                                                                              | updater config                      |
| Workflows       | `reactions-price-refresh`, `reactions-daily`, `reactions-sde-sync`, `reactions-history-backfill`                                                                                                             | updater config (created by deploy)  |
| Service binding | web `UPDATER` to `reactions-updater`, entrypoint `UpdaterRpc` (production and preview both call the production updater)                                                                                      | web config                          |
| Rate limiters   | `API_RATE_LIMITER` (120 per 60 s per IP) and `ACCOUNT_RATE_LIMITER` (10 per 60 s per account); namespaces `3001`/`3002` in production, `3101`/`3102` in the preview                                          | web config (created by deploy)      |

**How the preview works.** It is a Cloudflare [Worker Preview](https://developers.cloudflare.com/workers/previews/) of `reactions-web`: the same Worker with the settings of the `previews` block ("Previews Base") in `apps/web/wrangler.jsonc`. Since the cutover it is served on `https://preview.reactions.coalition.space`: the web route `reactions.coalition.space` has `"previews_enabled": true`, so Previews answer on `<preview name>.reactions.coalition.space` (Cloudflare manages the wildcard DNS record and certificate), and `"preview_urls": false` keeps them off `workers.dev`. Before the cutover it was served on `https://preview-reactions-web.zmiguel.workers.dev`, because **a route on `reactions.coalition.space` cannot be deployed while another Worker holds the domain**: deploying one, even with `"enabled": false` and `"previews_enabled": true`, moves the domain to `reactions-web` (on 2026-10-08 this served the empty v3 site on `reactions.coalition.space` for about three minutes, until the domain was reattached to `eve-reactions`). The config gate pins the route through `CUTOVER_DONE`. Cron triggers and Workflows only run in production and a Preview's service binding always calls the production updater, so the updater has no preview: it is deployed to production from the start and fills the production D1/KV with live data. The preview reads the same databases and KV (same ids in `previews`), so what you check on the preview is exactly the data production will serve, and the cutover moves no data. The preview differs in its vars (its own EVE SSO application and callback, `DEPLOY_ENV=preview`, which adds `X-Robots-Tag: noindex, nofollow` on custom domains), its secrets and its rate-limit counters. Logins on the preview create real accounts in the production database.

**Never use test data.** Only migrations (schema plus the six NPC hubs) and the live jobs of step 9 write to the remote resources. `npm run seed:local`, `npm run e2e:server` and `npm run test:e2e` only touch local state (`--local`/`--persist-to`); never point them, or any other command with seed data, at remote resources. Never set `DEV_LOGIN` in either config. Step 10 checks that no seed rows exist.

Old v2 workers being replaced (from `EVE-Reactions-Calculator/wrangler.jsonc` and `EVE-Reactions-Calculator/update/wrangler.jsonc`):

| Worker                  | Role            | Trigger                                   |
| ----------------------- | --------------- | ----------------------------------------- |
| `eve-reactions`         | v2 site         | custom domain `reactions.coalition.space` |
| `eve-reactions-updater` | v2 data updater | cron `*/30 * * * *`                       |

v3 does not read or migrate any v2 data (D1 `eve-reactions`, its KV namespaces). Price history in v3 starts from ESI history and the market history import. v2 visitors' settings cookies are converted on their first page visit to v3 (see `docs/architecture.md`, "Settings model").

## 0. Prerequisites

1. A Cloudflare account with the zone `coalition.space` (the v2 site already uses it).
2. Workers Paid plan: the updater sets `limits.cpu_ms: 300000`, which the free plan does not allow.
3. Node.js 26+ and the repository checked out; then:

   ```bash
   npm ci
   ```

   Worker Previews need wrangler 4.135 or later; the repository pins 4.147.

4. Log in with wrangler and check the account:

   ```bash
   npx wrangler login
   npx wrangler whoami
   ```

   If `whoami` lists several accounts, set `CLOUDFLARE_ACCOUNT_ID=<FILL: account id>` in your shell for every command below (or `account_id` in both configs).

5. An EVE Online account to create the developer application, and the character id(s) that should become admins: `<FILL: admin character ids>` (the number in `https://evewho.com/character/<id>` or zKillboard URLs).

6. Verify the code before deploying anything:

   ```bash
   npm run lint
   npm run check
   npm test
   npm run build -w apps/web
   ```

## 1. Create the storage resources

Run from the repo root. If wrangler asks whether it should add the new resource to your config file, answer **No**: both config files already contain the bindings; you only paste the ids.

```bash
npx wrangler d1 create reactions-core
npx wrangler d1 create reactions-history
npx wrangler kv namespace create reactions-cache
npx wrangler r2 bucket create reactions-archive
```

Optional: `--location weur` (or another hint) on `d1 create` places the primary database near you.

Note the printed ids:

- `reactions-core` database id: `<FILL: core database_id>`
- `reactions-history` database id: `<FILL: history database_id>`
- `reactions-cache` KV id: `<FILL: KV namespace id>`

## 2. Write the ids into the wrangler.jsonc files

Replace the placeholder ids everywhere they occur: `apps/updater/wrangler.jsonc` (top level) and `apps/web/wrangler.jsonc` (top level **and** the `previews` block, which uses the same live data):

| Placeholder                                                                | Replace with                  |
| -------------------------------------------------------------------------- | ----------------------------- |
| `00000000-0000-0000-0000-000000000001` (`DB`, `reactions-core`)            | `<FILL: core database_id>`    |
| `00000000-0000-0000-0000-000000000002` (`HISTORY_DB`, `reactions-history`) | `<FILL: history database_id>` |
| `00000000000000000000000000000003` (`CACHE`)                               | `<FILL: KV namespace id>`     |

The R2 bucket is referenced by name (`reactions-archive`, updater only) and needs no id. Check the ids:

```bash
git grep -n "00000000" -- apps/web/wrangler.jsonc apps/updater/wrangler.jsonc
npx vitest run --project scripts
```

The `git grep` must print nothing; the vitest run checks among other things that every occurrence carries the same id. The full gate (`CHECK_PROD_IDS=1`) follows in step 8, once the vars are set. Commit these ids (they are not secrets).

## 3. Apply the migrations to the remote databases

Run in `apps/web` (the updater config points at the same migration folders, so either app directory works):

```bash
cd apps/web
npx wrangler d1 migrations apply reactions-core --remote
npx wrangler d1 migrations apply reactions-history --remote
cd ../..
```

Confirm the prompts. Expected migrations (schema only, plus the six NPC hubs in `0001`; no test data):

- `reactions-core`: `0000_secret_outlaw_kid`, `0001_seed_market_hubs` (the six NPC hubs), `0002_session_character`, `0003_market_stats_volume_7d`, `0004_job_run_progress`
- `reactions-history`: `0000_red_tomorrow_man`

Check:

```bash
cd apps/web
npx wrangler d1 migrations list reactions-core --remote
npx wrangler d1 migrations list reactions-history --remote
cd ../..
```

Both must report no pending migrations.

## 4. EVE developer application

Login and the structure-market feature need EVE SSO applications: one for production and one for the preview, each with its own callback. Every deployment logs in with its own application (`EVE_SSO_CLIENT_ID`) and knows the other one (`EVE_SSO_EXTRA_CLIENT_ID` plus secret `EVE_SSO_EXTRA_CLIENT_SECRET`); each character stores the application that issued its refresh token (`characters.sso_client_id`), so the updater and both web deployments refresh tokens of either application. Create both applications with the steps below.

1. Open <https://developers.eveonline.com/applications> and create an application, type "Authentication & API Access".
2. Name and description: `<FILL: application name>`, for example "EVE Reactions Calculator".
3. Callback URL:
   - production application: `https://reactions.coalition.space/auth/callback`
   - preview application: `https://preview.reactions.coalition.space/auth/callback` (before the cutover `https://preview-reactions-web.zmiguel.workers.dev/auth/callback`; change `previews.vars.EVE_SSO_CALLBACK_URL` with it)
4. Scopes: all of `ALL_ESI_SCOPES` (`packages/eve/src/scopes.ts`). Login itself asks for none; the structure feature uses three; the other three are registered for a later feature:
   - `esi-assets.read_assets.v1`
   - `esi-industry.read_character_jobs.v1`
   - `esi-markets.structure_markets.v1`
   - `esi-search.search_structures.v1`
   - `esi-universe.read_structures.v1`
   - `esi-wallet.read_character_wallet.v1`
5. Save, then note `<FILL: EVE SSO client id>` and `<FILL: EVE SSO client secret>`.

## 5. Vars in wrangler.jsonc

Vars live in the config files (a deploy overwrites vars set in the dashboard). Every value to fill is marked with a `// FILL:` comment (database and KV ids, client id, admin ids, User-Agent URL and contact, optionally `account_id`), and each file lists its secrets in a comment next to `vars`. Edit and commit:

`apps/web/wrangler.jsonc`, top-level `vars` (production) and `previews.vars` (the preview):

| Var                       | Production (`vars`)                                                                            | Preview (`previews.vars`)                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `EVE_SSO_CLIENT_ID`       | `<FILL: production application client id>`                                                     | `<FILL: preview application client id>`                       |
| `EVE_SSO_EXTRA_CLIENT_ID` | the preview application's client id                                                            | the production application's client id                        |
| `EVE_SSO_CALLBACK_URL`    | `https://reactions.coalition.space/auth/callback` (committed)                                  | `https://preview.reactions.coalition.space/auth/callback`     |
| `ADMIN_CHARACTER_IDS`     | `<FILL: admin character ids>`, comma-separated, for example `"12345678,87654321"`              | the same                                                      |
| `USER_AGENT_URL`          | `<FILL: public URL or source repository>`, for example `"https://reactions.coalition.space/"`  | the same                                                      |
| `USER_AGENT_CONTACT`      | `<FILL: your contact>`, for example `"mail:you@example.com; eve:Character Name; discord:name"` | the same                                                      |
| `DEPLOY_ENV`              | `production` (committed)                                                                       | `preview` (committed): adds `X-Robots-Tag: noindex, nofollow` |

Every outgoing request (ESI, EVE SSO, SDE, Fuzzwork, the history mirror) sends `User-Agent: EVE-Reactions-Calculator/<version> (+<USER_AGENT_URL>; <USER_AGENT_CONTACT>)`, following the [ESI best practices](https://developers.eveonline.com/docs/services/esi/best-practices/#user-agents). The version is each worker's `package.json` version; empty vars are left out. Whoever deploys fills in their own contact, so CCP and the API operators reach the person running this instance.

There is no site URL var: canonical, sitemap and OG URLs always use `https://reactions.coalition.space` (`SITE_URL` in `apps/web/src/lib/site.ts`), also on the preview.

`apps/updater/wrangler.jsonc`, `vars`:

| Var                  | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| `EVE_SSO_CLIENT_ID`  | `<FILL: EVE SSO client id>` (the same application as the web) |
| `USER_AGENT_URL`     | `<FILL>`, the same value as the web                           |
| `USER_AGENT_CONTACT` | `<FILL>`, the same value as the web                           |

Never add `DEV_LOGIN` to any config. Both workers also have `observability` with logs (including invocation logs), traces and real-time Issues enabled; nothing to fill.

## 6. Generate the secrets

| Secret                        | Where                                | Format                                                                                                                     |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `EVE_SSO_CLIENT_SECRET`       | updater, web production, web preview | Secret of the deployment's own application: production app for the updater and web production, preview app for the preview |
| `EVE_SSO_EXTRA_CLIENT_SECRET` | updater, web production, web preview | Secret of the other application: preview app for the updater and web production, production app for the preview            |
| `SESSION_SECRET`              | web production, web preview          | Standard base64 of at least 32 bytes (HMAC key for the login state cookie)                                                 |
| `TOKEN_ENCRYPTION_KEY`        | updater, web production, web preview | base64 of exactly 32 bytes (AES-256-GCM key); **the same value everywhere** (shared token store)                           |

Generate `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` (run twice, one value each):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Store `TOKEN_ENCRYPTION_KEY` in your password manager: losing or changing it makes every stored refresh token unreadable. Never use the dev key from `.dev.vars.example`: it is public in the repository. The preview may use its own `SESSION_SECRET` or the production one.

## 7. Deploy the updater (production)

The web worker has a service binding to `reactions-updater`, so the updater must exist first.

```bash
cd apps/updater
npx wrangler deploy --dry-run
npx wrangler deploy
npx wrangler secret put EVE_SSO_CLIENT_SECRET         # production application
npx wrangler secret put EVE_SSO_EXTRA_CLIENT_SECRET   # preview application
npx wrangler secret put TOKEN_ENCRYPTION_KEY
cd ../..
```

`secret put` prompts for the value. The deploy registers the cron and the four workflows. The updater has no public URL (`workers_dev: false`, no fetch handler). From now on the cron runs every 10 minutes against the live sources:

- the first ticks fetch cost indices and adjusted prices, and may start a price refresh before the SDE exists (it stores nothing useful; step 9 runs another one);
- at minutes 0 to 9 of the next hour it starts the SDE import `sde-<build>` by itself;
- the daily job waits for the first SDE import (log `daily: skipped (no SDE imported yet)`), then starts `daily-<today>` at the first tick after the import once it is past 11:20 UTC.

Optional: watch the logs with `npx wrangler tail reactions-updater`, or in the dashboard (Workers & Pages, `reactions-updater`, Observability).

## 8. Deploy the web Worker and its preview

1. Run the deploy gate. It checks both `wrangler.jsonc` files: every binding present, identical ids in both workers and the `previews` block, identical client id and User-Agent vars, no `DEV_LOGIN`, logs/traces/Issues on, the preview's callback, `DEPLOY_ENV` and own rate-limit namespaces; with `CHECK_PROD_IDS=1` also no placeholder id and every FILL value set (production and preview vars):

   ```bash
   CHECK_PROD_IDS=1 npx vitest run --project scripts
   ```

   PowerShell: `$env:CHECK_PROD_IDS = '1'; npx vitest run --project scripts; Remove-Item Env:CHECK_PROD_IDS`.

2. Build and deploy the production version once. It has no route and no `workers.dev` URL, so it serves no traffic yet; the deploy creates the Worker, turns on `workers.dev` Preview URLs and creates the rate limiters:

   ```bash
   npm run build -w apps/web
   cd apps/web
   npx wrangler deploy --dry-run
   npx wrangler deploy
   npx wrangler secret put EVE_SSO_CLIENT_SECRET         # production application
   npx wrangler secret put EVE_SSO_EXTRA_CLIENT_SECRET   # preview application
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```

   On Windows, if the build fails with `EPERM`, stop `npm run dev`, delete `apps/web/.svelte-kit/cloudflare` and build again.

3. Set the preview's secrets (Previews Base; every new Preview receives them):

   ```bash
   npx wrangler preview base-config secret put EVE_SSO_CLIENT_SECRET         # preview application
   npx wrangler preview base-config secret put EVE_SSO_EXTRA_CLIENT_SECRET   # production application
   npx wrangler preview base-config secret put SESSION_SECRET
   npx wrangler preview base-config secret put TOKEN_ENCRYPTION_KEY
   ```

4. Deploy the preview (still in `apps/web`, from the same build):

   ```bash
   npx wrangler preview --name preview
   cd ../..
   ```

   It prints the Preview URL (`https://preview.reactions.coalition.space`; `https://preview-reactions-web.zmiguel.workers.dev` before the cutover) and a unique deployment URL. Base secrets set after a Preview exists do not reach it: set them on the existing preview with `npx wrangler preview secret put <NAME> --name preview`.

Until the first data load finishes, pages show "Market data is not available yet" and the API answers 503.

## 9. First data load

Do these in order and wait for each to finish. Two ways to start jobs:

- **Admin page** (recommended): log in on the preview (`https://preview-reactions-web.zmiguel.workers.dev` before the cutover, `https://preview.reactions.coalition.space` now) or on production with an admin character, open `/admin`, use the buttons. They call the production updater.
- **CLI**: `npx wrangler workflows trigger ...` run in `apps/updater` (bash quoting; PowerShell and cmd alter the JSON quotes when calling `npx`).

### 9.1 SDE import

The cron starts it at the next full hour. To start it now, either click SDE sync **Check for new build** (or **Re-import (force)**) on `/admin`, or look up the current build number in `https://developers.eveonline.com/static-data/tranquility/latest.jsonl` (`buildNumber`) and run:

```bash
cd apps/updater
npx wrangler workflows trigger reactions-sde-sync '{"build":<FILL: current SDE build>}' --id sde-<FILL: current SDE build>
```

Done when `/admin` shows the SDE build and the `sde` job is `ok`.

### 9.2 First full price refresh

Click Prices **Refresh now**, or:

```bash
npx wrangler workflows trigger reactions-price-refresh
```

Done when the `prices` job is `ok` (or `partial` with Fuzzwork fallbacks). The cron keeps refreshing every 30 minutes from then on.

### 9.3 Daily job

Fetches about 13 months of ESI market history for every hub region and computes market stats. Nothing to do when it is past 11:20 UTC: the cron starts `daily-<today>` at the first tick after the SDE import. Before 11:20 UTC, either wait or start it now with Daily **Run for today**, or:

```bash
npx wrangler workflows trigger reactions-daily '{"date":"<FILL: today UTC, YYYY-MM-DD>"}' --id daily-<FILL: today>-manual-1
```

This run is long (one ESI request per type and region). Done when the `daily` job is `ok` (or `partial` when some types failed).

### 9.4 Import market history

After the first daily run, click Market history import **Import now** (no CLI parameters needed; `npx wrangler workflows trigger reactions-history-backfill` also works). It replaces regional history from 2025-02-01 with the market.coalition.space mirror and recomputes market stats. Done when the `history` job is `ok`.

### Checking job status

- `/admin`: the Jobs table has one row per job with its latest run (status, start, duration, detail with errors), its run button(s) and a **History** window with its 25 newest runs; a running workflow shows its current step, a progress bar, its last activity and a "Possibly stuck" marker, and the page refreshes itself every 10 seconds.
- Logs: `npx wrangler tail reactions-updater` shows each trigger (`[rpc]`, `[scheduled]`), each run's start and end (`[job]`) and every workflow step (`[<run id>] step 3/14 …`). The dashboard keeps the same logs, the traces and the Issues.
- CLI, in `apps/updater`:

  ```bash
  npx wrangler workflows instances list reactions-sde-sync
  npx wrangler workflows instances list reactions-daily
  npx wrangler workflows instances list reactions-price-refresh
  npx wrangler workflows instances list reactions-history-backfill
  npx wrangler workflows instances describe reactions-daily <instance id>
  ```

  `describe` shows every step with retries and errors.

- `https://preview.reactions.coalition.space/api/v2/meta`: `sdeBuild`, `pricesUpdatedAt`, `costIndicesUpdatedAt`, `adjustedUpdatedAt`.

## 10. Check that no test data exists

The remote databases must contain only live data. Every count must be `0`:

```bash
cd apps/web
npx wrangler d1 execute reactions-core --remote --command "SELECT (SELECT COUNT(*) FROM users WHERE user_id = 'seed-user') AS seed_users, (SELECT COUNT(*) FROM characters WHERE character_id IN (90000001, 90000002)) AS seed_characters, (SELECT COUNT(*) FROM market_hubs WHERE hub_id IN ('structure-1044752365771', 'structure-1042508032148')) AS seed_hubs, (SELECT COUNT(*) FROM job_runs WHERE detail_json LIKE '%\"seed\":true%') AS seed_jobs"
cd ../..
```

`market_hubs` must hold exactly the six NPC hubs plus structures real users added. If anything is non-zero, find how it got there before going on: the seed scripts only write local state.

## 11. Check the preview

1. Install Playwright's browser once:

   ```bash
   cd apps/web
   npx playwright install chromium
   ```

2. Run the read-only smoke specs against the preview:

   ```bash
   BASE_URL=https://preview.reactions.coalition.space npx playwright test --grep "@smoke"
   ```

   PowerShell: `$env:BASE_URL = 'https://preview.reactions.coalition.space'; npx playwright test --grep "@smoke"`.

   They cover the home page, all three reactor listings (the expected count comes from the same site's `/api/v2/reactions`), the legacy 301 table, API JSON/CSV, API v1 410, sitemap, robots, the footer and external links. None of them logs in.

3. `curl -sI https://preview.reactions.coalition.space/` shows an `x-robots-tag` with `noindex` (on Windows PowerShell use `curl.exe`).
4. By hand: log in with EVE SSO, open `/admin` and `/admin/hubs`, enable structure markets for a character on `/account` if you want to test that flow, change a setting and reload.
5. v2 settings import: v2 cookies belong to `reactions.coalition.space` only, so the preview never receives real ones. To try it, open the preview in a private window, run `document.cookie = "brokers=2.5; path=/"; document.cookie = "facility=medium; path=/"` in the browser console and reload: `/settings` shows broker fee 2.5 % and Athanor, and the two cookies are gone.
6. Cloudflare dashboard, Workers & Pages, both workers, Observability: logs and traces arrive; Issues lists errors (expect none).
7. Optional: `BASE_URL=https://preview.reactions.coalition.space npm run lhci` (run from the repo root). Lighthouse marks the `noindex` header as an SEO failure on the preview; check SEO on production.

The preview stays available after the cutover, on `https://preview.reactions.coalition.space` only (the cutover sets `"preview_urls": false`); it keeps its own SSO application, whose callback moves with it.

## 12. Production cutover (B14)

Done on 2026-10-08 (about 15:11 UTC) as follows:

1. The production SSO application already has the production callback; nothing to change.
2. In one commit, in `apps/web/wrangler.jsonc`: add the route, set `"preview_urls": false` and move the preview callback to the custom domain; in `scripts/test/wrangler-config.test.ts`: set `CUTOVER_DONE = true`:

   ```jsonc
   "preview_urls": false,
   "routes": [{ "pattern": "reactions.coalition.space", "custom_domain": true, "previews_enabled": true }],
   // previews.vars:
   "EVE_SSO_CALLBACK_URL": "https://preview.reactions.coalition.space/auth/callback",
   ```

   Check:

   ```bash
   CHECK_PROD_IDS=1 npx vitest run --project scripts
   ```

3. Deploy production. The deploy moves the custom domain from `eve-reactions` to `reactions-web` by itself (a custom domain belongs to one Worker), so there is no separate removal step and no gap between two manual steps:

   ```bash
   npm run build -w apps/web
   cd apps/web
   npx wrangler deploy        # prints "reactions.coalition.space (custom domain) [previews: enabled]"
   npx wrangler preview --name preview
   cd ../..
   ```

   The preview answers on `https://preview.reactions.coalition.space` within seconds to minutes (Cloudflare provisions the wildcard DNS record and certificate).

4. In the EVE developer portal, set the preview application's callback to `https://preview.reactions.coalition.space/auth/callback`; until then login on the preview fails.
5. Open `https://reactions.coalition.space`, log in once to confirm SSO, and check that `curl -sI https://reactions.coalition.space/` has **no** `x-robots-tag` while `curl -sI https://preview.reactions.coalition.space/` has `noindex, nofollow`.

## 13. Disable the old updater cron

Cloudflare dashboard, Workers & Pages, `eve-reactions-updater`, Settings, Trigger events (Cron Triggers): delete `*/30 * * * *`.

Keep both v2 workers deployed but unrouted for 14 days, for rollback.

## 14. Post-deploy checks

1. Meta:

   ```bash
   curl -s https://reactions.coalition.space/api/v2/meta
   ```

   `sdeBuild` equals the current SDE build; `pricesUpdatedAt` is less than 35 minutes old; `costIndicesUpdatedAt` and `adjustedUpdatedAt` are set; `hubs` lists the six NPC hubs.

2. Smoke specs against production (read-only):

   ```bash
   cd apps/web
   BASE_URL=https://reactions.coalition.space npx playwright test --grep "@smoke"
   ```

3. Legacy URLs: request every v2 URL pattern for every reaction product id (the list comes from the site's `/api/v2/reactions`). Each must answer 301 to the matching v3 page, which must answer 200; the command exits non-zero and names every failing URL otherwise:

   ```bash
   npm run check:legacy -- https://reactions.coalition.space
   ```

   Spot checks by hand (`301` with the shown `location`; on Windows PowerShell use `curl.exe`):

   ```bash
   curl -sI https://reactions.coalition.space/composite/simple/16663       # /composite/caesarium-cadmide
   curl -sI https://reactions.coalition.space/composite/chain/16671        # /composite/titanium-carbide?view=chain
   curl -sI https://reactions.coalition.space/biochemical/simple/28686     # /biochemical/pure-synth-blue-pill-booster
   curl -sI https://reactions.coalition.space/biochemical/chain/25241      # /biochemical/pure-improved-blue-pill-booster?view=chain
   curl -sI https://reactions.coalition.space/hybrid/30306                 # /hybrid/methanofullerene
   curl -s  https://reactions.coalition.space/api/v1/composite/simple/16663 # 410 JSON, code API_V1_REMOVED
   ```

   A `307` to the listing instead of `301` means the site has no dataset loaded (check the SDE import).

4. Google Search Console, property `reactions.coalition.space`: Sitemaps, submit `https://reactions.coalition.space/sitemap.xml`. After about 7 days, check Pages for new 404s.
5. A browser that still has v2 cookies: the first page load keeps its changed settings (for example a non-default broker fee) and removes every v2 cookie.
6. `/admin` after a day: `daily` ran after 11:20 UTC, `prices` runs every 30 minutes with status `ok`.

## Rollback

### Bad deploy of a v3 worker

```bash
cd apps/web            # or apps/updater
npx wrangler deployments list
npx wrangler rollback  # previous version; or: npx wrangler rollback <version id>
```

A bad preview deployment: run `npx wrangler preview --name preview` again from a good commit.

Rollback does not undo D1 migrations. To restore a database to a point in time (whole database):

```bash
npx wrangler d1 time-travel restore reactions-core --timestamp=<FILL: ISO timestamp before the problem>
```

### Back to v2 (within the 14 days)

1. Give the domain back to `eve-reactions`: dashboard, `eve-reactions`, Settings, Domains & Routes, Add, Custom domain `reactions.coalition.space` (it moves the domain off `reactions-web`); then remove the route from `apps/web/wrangler.jsonc`, set `"preview_urls": true` and the preview callback back to `https://preview-reactions-web.zmiguel.workers.dev/auth/callback` (and in the EVE developer portal), and set `CUTOVER_DONE = false` so no later deploy takes the domain back.
2. Re-add the cron `*/30 * * * *` to `eve-reactions-updater`.
3. The v3 updater can keep running; it writes only to the v3 resources.

## Routine operations

### Redeploy

```bash
npm run lint && npm run check && npm test
cd apps/updater && npx wrangler deploy && cd ../..
npm run build -w apps/web
cd apps/web
npx wrangler preview --name preview   # try the change on the preview first
npx wrangler deploy                    # then production
cd ../..
```

Deploy only the worker that changed. When a change touches `UpdaterRpc` (`apps/updater/src/rpc.ts`) and its caller (`apps/web/src/lib/server/updater.ts`), deploy the updater first: the preview and production both call the production updater, so keep `UpdaterRpc` backwards compatible while an older web deployment is live.

### New migrations

1. Change the schema in `packages/db/src/schema/*.ts`, then `npm run db:generate`.
2. Apply remotely **before** deploying code that needs the change (the preview and production share the databases):

   ```bash
   cd apps/updater
   npx wrangler d1 migrations list reactions-core --remote
   npx wrangler d1 migrations apply reactions-core --remote
   npx wrangler d1 migrations apply reactions-history --remote
   cd ../..
   ```

3. Deploy the workers.

### Rotating secrets

| Secret                                                  | How                                                                                                                                                                                                                                                                              | Effect                                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`                                        | `npx wrangler secret put SESSION_SECRET` in `apps/web`; preview: `npx wrangler preview secret put SESSION_SECRET --name preview`                                                                                                                                                 | Logins in progress (10-minute state cookie) fail and must be retried; sessions stay valid                                            |
| `EVE_SSO_CLIENT_SECRET` / `EVE_SSO_EXTRA_CLIENT_SECRET` | Regenerate in the developer application, then set the new value wherever that application appears: `EVE_SSO_CLIENT_SECRET` where it is the own app, `EVE_SSO_EXTRA_CLIENT_SECRET` where it is the other one (both apps, and `preview secret put --name preview` for the preview) | None, once every deployment has the new value                                                                                        |
| `TOKEN_ENCRYPTION_KEY`                                  | `secret put` with one new value in both apps and the preview                                                                                                                                                                                                                     | All stored refresh tokens become unreadable; characters are marked invalid at next use and users must enable structure markets again |

`wrangler secret put` deploys a new version of the worker at once. `preview base-config secret put` only affects Previews created later; `preview secret put --name preview` changes the existing preview.

### SDE updates

Automatic: the cron checks `latest.jsonl` every hour and imports a newer build. On `/admin`, SDE sync **Check for new build** does the same now; **Re-import (force)** re-imports the current build.

### Admin list

Edit `ADMIN_CHARACTER_IDS` in `apps/web/wrangler.jsonc` (top-level `vars` and `previews.vars`), build and deploy the web app and the preview. Admin rights belong to the character id: remove a character from the list before it is transferred or sold.

### Logs, traces and Issues

```bash
npx wrangler tail reactions-updater
npx wrangler tail reactions-web
```

Both workers send logs (with invocation logs) and traces to the Cloudflare dashboard (Workers & Pages, the worker, Observability) and report errors as real-time Issues; the preview has its own view in the dashboard's Preview selector.
