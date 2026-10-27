# Operations

Day-to-day running of the production site. Deployment and rollback are in [deploy.md](deploy.md); data flow in [architecture.md](architecture.md).

## Admin access

Admins are the accounts that hold a character listed in `ADMIN_CHARACTER_IDS` (`apps/web/wrangler.jsonc`). Log in with EVE SSO; the account menu then shows **Admin**. Everyone else gets a plain 404 on the admin pages. Both pages are `noindex`.

Admin rights are bound to character ids only. Before an admin character is transferred or sold, remove its id from `ADMIN_CHARACTER_IDS` and redeploy the web app; otherwise the new owner becomes an admin at their next login.

Never use the dev `TOKEN_ENCRYPTION_KEY` from `.dev.vars.example` in production: it is public in the repository.

## `/admin`

| Section                    | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs                       | One row per job of the registry (`apps/web/src/lib/admin/jobs.ts`, keyed by `JOB_KINDS` in `packages/db/src/jobs.ts`, so every kind the updater records has a row; a new kind does not compile without one), also before its first run ("Never run"): latest run with how it was started (cron, manual, retry), status (`running`, `ok`, `partial`, `failed`), start, duration (or "running N"), detail (error message, else counts), the run button(s) and **History** |
| SDE                        | Imported build, release date, import time                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Latest prices by source    | Row count of `latest_prices` per source (`esi`, `esi_structure`, `fuzzwork`) and total                                                                                                                                                                                                                                                                                                                                                                                  |
| Structure hubs with errors | Structure hubs whose `last_error` is set, with the error and last success                                                                                                                                                                                                                                                                                                                                                                                               |

**History** opens a window with the job's 25 newest runs (newest `started_at` first), with the same columns. Run buttons (each calls the updater over the `UPDATER` service binding and shows a notice):

| Job (`job_runs.kind`)               | Button(s)                              | Starts                                                                                                                                                         | Run id                                   |
| ----------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Prices (`prices`)                   | Refresh now                            | `reactions-price-refresh`                                                                                                                                      | `prices-manual-<ms>`                     |
| Adjusted prices (`adjusted_prices`) | Fetch now                              | Inline in the RPC call: ESI `/markets/prices` even while the cached response is fresh (the stored ETag is sent; 304 ends `ok` with "ESI returned no new data") | `adjusted_prices-manual-<ms>`            |
| Cost indices (`cost_indices`)       | Fetch now                              | The same for `/industry/systems`                                                                                                                               | `cost_indices-manual-<ms>`               |
| SDE sync (`sde`)                    | Check for new build, Re-import (force) | `reactions-sde-sync` when a newer build exists (otherwise "skipped", no row), or for the current build even if already imported                                | `sde-<build>`, `sde-<build>-manual-<ms>` |
| Daily (`daily`)                     | Run for today                          | `reactions-daily` for today (UTC)                                                                                                                              | `daily-<date>-manual-<ms>`               |
| Market history import (`history`)   | Import now                             | `reactions-history-backfill`                                                                                                                                   | `history-backfill-manual-<ms>`           |
| Market snapshot (`market_snapshot`) | Publish now                            | Inline: rewrites KV `market:v1` from the hub table and latest prices; also recorded for the publishes `/admin/hubs` makes after hub changes                    | `market_snapshot-manual-<ms>`            |
| Inventory sync (`inventory`)        | Sync now                               | Inline: the daily inventory pass at once, ignoring the 12:00 UTC gate and today's attempts; each source it starts is a `reactions-inventory-sync` instance     | `inventory-manual-<ms>`                  |
| Profit tracking (`tracking`)        | Run now                                | Inline: the tracking pass (cron step 8) at once; each connection it starts is a `reactions-tracking-sync` instance, then up to 10 dirty ledgers are rebuilt    | `tracking-manual-<ms>`                   |

Manual runs never collide with cron ids. Starting a job whose latest run is still running asks for confirmation instead of being blocked, so a run stuck as `running` can always be restarted.

### Following a running job

While any row is `running` the page refreshes itself every 10 seconds ("Updating every 10 s"). A running workflow row shows:

- the step in progress, e.g. `Step 3 of 14: types-1` (`Step 1: plan` until the plan step knows the total), with a progress bar;
- `last activity N min ago`: when the current step started (each step writes `job_runs.progress_json` and `progress_at`);
- the live Workflows status when it is not running or queued, e.g. `Workflow errored: <error>`;
- **Possibly stuck** when nothing happened for 15 minutes (a step may take up to 10 minutes plus retries) or when the workflow already ended (errored, terminated, complete, unknown) while the row still says running. Price runs are settled automatically by the next cron tick (see below); for other kinds check the updater logs and terminate the instance with `npx wrangler workflows instances terminate <workflow> <run id>` if needed.

## `/admin/hubs`

"Waiting for review" lists structure markets that users asked to share:

- **Approve**: the hub becomes public (listed for everyone, included in `market:v1`); records the reviewing admin character and time.
- **Reject**: the hub stays private for its linked users.

"All hubs" lists every hub with visibility, share status, enabled flag, order, contributors (character names) and last success or error:

- **Enable / Disable** (public hubs): disabled hubs are not refreshed and not offered.
- **Move up / Move down** (public hubs): order in hub selects; public hubs are renumbered 1 to n.
- **Revoke public** (public structure hubs): back to private, share status `rejected`.
- **Delete** (structure hubs, with confirmation): removes the hub, its links, latest prices and history.

NPC hubs (Jita 4-4, Amarr, Perimeter, Dodixie, Rens, Hek) cannot be revoked or deleted, only disabled and reordered.

Changes to public hubs republish `market:v1` at once through the updater. If the updater does not answer, the change is saved and the notice says public prices show it after the next price refresh. Pages cache the snapshot for up to about a minute.

## Jobs and schedule

The updater cron runs every 10 minutes (`*/10 * * * *`). Each tick runs these steps in order; a failing step is logged and the next one still runs.

Log lines (`npx wrangler tail reactions-updater`, or the Workers dashboard: Observability keeps logs, traces and real-time Issues for both workers):

| Prefix        | Example                                                                            | When                                                                          |
| ------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `[scheduled]` | `[scheduled] prices: started prices-1791363600000`                                 | each cron step of each tick                                                   |
| `[rpc]`       | `[rpc] triggerHistoryBackfill: starting history-backfill-manual-1791406566111`     | an admin button called the updater                                            |
| `[job]`       | `[job] prices-1791363600000 started (prices, cron)`, `[job] … ok after 75.2s: {…}` | a run starts (with cron, manual or retry) and ends (status, duration, result) |
| `[<run id>]`  | `[history-backfill-manual-…] step 3/14 types-1: done in 2.8s {"rows":33368,…}`     | each workflow step starts, ends (duration, result) or fails (error)           |
| `[esi]`       | `[esi] online again: 25000 players`                                                | a `/status` check after the daily downtime (see ESI daily downtime)           |

| Job (`job_runs.kind`)               | Schedule                                                                                                                                                                                                                                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adjusted prices (`adjusted_prices`) | Every tick, fetches only when the cached ESI response expired                                                                                                                                                                               | ESI `/markets/prices` into `adjusted_prices` (tracked types), republishes `market:v1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Cost indices (`cost_indices`)       | Every tick, fetches only when the cached ESI response expired                                                                                                                                                                               | ESI `/industry/systems` into `cost_indices`, republishes `market:v1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Price refresh (`prices`)            | Every 30 minutes (`PRICE_REFRESH_MINUTES`), workflow `reactions-price-refresh`                                                                                                                                                              | Orders of every tracked type at every enabled hub (ESI, Fuzzwork fallback), structure markets, `latest_prices`, `price_snapshots`, KV `market:v1`, R2 archive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| SDE sync (`sde`)                    | Checked hourly (minutes 0 to 9), workflow `reactions-sde-sync` when a new build exists                                                                                                                                                      | Downloads the industry bonus data from Hoboleaks and the SDE, parses them, replaces reference and reaction tables, KV `dataset:v1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Daily (`daily`)                     | Once per day from 11:20 UTC, workflow `reactions-daily`; waits until the first SDE import exists (`skipped (no SDE imported yet)`)                                                                                                          | New ESI regional history days, market stats, yesterday's `price_daily`, today's index snapshots, archive check, snapshot retention, pruning of old `job_runs` and expired sessions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Market history import (`history`)   | Manual only (`/admin`)                                                                                                                                                                                                                      | Replaces regional history from 2025-02-01 with market.coalition.space data, recomputes market stats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Affiliations (`affiliations`)       | Once a day, on the first tick from 12:20 UTC whose day has no `ok`/`partial` run yet (a failed run or a tick skipped for the ESI downtime is retried on the next tick; skipped ticks write no row); "Fetch now" on `/admin` runs it at once | ESI `POST /characters/affiliation` + `POST /universe/names` (100 ids per request) for the characters of accounts seen in the last 30 days into the `characters` corporation and alliance columns, used for the Rybbit traits; `partial` when ESI refused a chunk. When the var `RYBBIT_SITE_ID` is not empty (`"1"` in `wrangler.jsonc`, empty in local `.dev.vars`), accounts whose main character's corporation or alliance trait changed get the new traits in Rybbit (`POST /api/identify`, also from the inventory and tracking syncs); "Fetch now" sends the traits of every covered account (back-fill). The row's `rybbit` counts `sent` and `failed` (failures are logged as `[rybbit] …`, never fail the job) |
| Inventory sync (`inventory`)        | Every tick from 12:00 UTC, up to 20 sources per tick, each once a day; only ticks that start syncs write a row                                                                                                                              | One workflow `reactions-inventory-sync` per asset source (`inventory-<sourceId>-<date>`) of accounts seen in the last 30 days: ESI assets into `inventory_items` and `inventory_locations`; the outcome is on the source (`status`, `last_error`), the row counts `started`, `skipped`, `busy`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Profit tracking (`tracking`)        | Every tick, up to 20 connections per tick, each at most once an hour and only when an ESI stream expired; ticks that find nothing due and rebuild no ledger write no row                                                                    | One workflow `reactions-tracking-sync` per connection with tracking on (`tracking-<sourceId>-<ms>`) of accounts seen in the last 30 days: industry jobs, wallet transactions and journal, market orders and contracts into the `tracked_*` tables, Janice appraisals, then the ledger rebuild; then up to 10 dirty ledgers. The outcome is on the connection (`tracking_status`, `tracking_last_error`) and its streams; the row counts `started`, `skipped`, `busy`, `ledgersRebuilt`, `ledgersFailed` (`partial` when a rebuild failed)                                                                                                                                                                               |

Workflow steps retry 3 times (30 s, exponential) with a 10-minute timeout each.

Rows for `adjusted_prices` and `cost_indices` are written only when new data arrived or the fetch failed; quiet ticks leave no row.

## Troubleshooting

### Price runs stuck or skipped

Symptom: the updater logs `prices: skipped (<run id> still running)` for a long time, or `/admin` shows a `prices` run "running" for more than 25 minutes.

The cron settles this itself on every tick: a running row whose workflow instance errored, was terminated or no longer exists becomes `failed` at once; an instance that is still "running" after 25 minutes (`PRICE_RUN_STALE_MINUTES`) is terminated and marked `failed` ("abandoned"). A failed run does not delay the next one; the next tick starts a new run (id `prices-<slot>-retry-<ms>` when the slot id is taken).

If you need to intervene:

```bash
cd apps/updater
npx wrangler workflows instances list reactions-price-refresh
npx wrangler workflows instances describe reactions-price-refresh <instance id>
npx wrangler workflows instances terminate reactions-price-refresh <instance id>
```

The next tick marks a terminated run `failed`. Then use Prices **Refresh now** if you do not want to wait.

### "The updater worker did not answer"

`/admin` buttons show `<Job> not started: the updater worker did not answer (<reason>)`; `/admin/hubs` saves the change but says it applies after the next price refresh.

1. Check the updater is deployed under the name `reactions-updater`: `npx wrangler deployments list --name reactions-updater`.
2. The web service binding targets `reactions-updater` with entrypoint `UpdaterRpc`. If the updater was renamed or redeployed without that export, redeploy the updater, then the web app.
3. Read the error in `npx wrangler tail reactions-web` and `npx wrangler tail reactions-updater` while pressing the button.

"the UPDATER binding is missing" means the web worker was deployed without the `services` entry in `apps/web/wrangler.jsonc`.

### Missing data states

| What you see                                                                                     | Cause                                                                                 | Fix                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Home or listing: "Market data is not available yet..."                                           | KV `dataset:v1` or `market:v1` missing (before the first SDE import or price refresh) | Run SDE sync **Re-import (force)**, then Prices **Refresh now**                   |
| API: 503 `INTERNAL` "Reference data is not available yet." / "Market data is not available yet." | Same                                                                                  | Same                                                                              |
| `/api/v2/meta`: `sdeBuild` or `pricesUpdatedAt` is `null`                                        | Same                                                                                  | Same                                                                              |
| "n/a" rows, warning "No market price for ..."                                                    | A type has no price at the chosen hub                                                 | Usually transient (thin market, Fuzzwork miss); check `prices` detail on `/admin` |
| "A market hub in your settings is not available to you; Jita 4-4 prices are used instead."       | Hub disabled, revoked, deleted, or the visitor logged out                             | Expected; the visitor picks another hub                                           |
| "No reaction cost index is known for ..."                                                        | `cost_indices` has no row for the system                                              | Wait for the next cost index fetch; check the `cost_indices` job                  |
| "Some inputs have no adjusted price, so the job cost is underestimated."                         | `adjusted_prices` lacks a type (for example right after an SDE import)                | Fixed by the next adjusted price fetch (the SDE import clears its cache)          |
| History chart days marked "≈", note about the region's average                                   | No hub price for that day; the region's ESI average is used                           | Expected for days before the first price refresh                                  |
| Home: "No daily price history yet."                                                              | No `price_daily` rows (and no ESI history) for the last 8 days                        | Wait for the daily job's rollup, or Daily **Run for today**                       |
| Home: "Market statistics are not available yet."; boards not filtered by market size             | No `market_stats` for the region yet                                                  | Wait for the daily job or Daily **Run for today**                                 |
| Legacy v2 URL answers 307 to the listing instead of 301                                          | No dataset loaded, so the reaction cannot be looked up                                | Run SDE sync **Re-import (force)**                                                |
| Structure search or add: "Too many requests. Wait a minute and try again." (429)                 | More than 10 searches or adds per minute on one account (`ACCOUNT_RATE_LIMITER`)      | Expected; wait a minute                                                           |
| API v2: 429 `RATE_LIMITED`                                                                       | More than 120 API requests per minute from one IP (`API_RATE_LIMITER`)                | Expected; the client retries after 60 s (`Retry-After`)                           |

### Structure hubs with errors

- A character's token is marked invalid (expired grant, revoked access, unreadable token, or a token from an EVE SSO application whose id or secret the worker lacks): the user enables the feature again on `/account`. The cause is only in the worker logs (`[tokens] character <id>` in the updater, `Token refresh of character <id>` in the web worker); a log line with `SSO_APP_UNKNOWN` means the application's credentials are missing: check `EVE_SSO_CLIENT_ID`/`EVE_SSO_EXTRA_CLIENT_ID` and their secrets on the updater and both web deployments.
- `NO_CONTRIBUTOR`: the last user linked to a public structure hub left; the hub is disabled. Delete it on `/admin/hubs` or wait for a user to link it again (adding re-enables it).
- Private structure hubs are refreshed only while a linked user was seen in the last 30 days.
- A structure hub deleted while a price refresh is running is skipped by that run; it does not fail the run.

### ESI throttling

The ESI client tracks rate-limit and error-limit headers. When fewer than 10 % of the rate limit remain, fewer than 20 errors remain, or ESI answers 420 or 429, the remaining types of that region step are priced from Fuzzwork instead and the run ends `partial`. Requests that fail with 5xx, 420 or 429 are retried once, honouring `Retry-After` up to 30 seconds (`MAX_RETRY_WAIT_SECONDS` in `packages/eve/src/esi.ts`); a longer `Retry-After` is not waited out, the response goes straight to the guard and the Fuzzwork fallback.

The daily job's market history works the same way, without a fallback: types it could not fetch (ESI errors, or skipped once fewer than 20 errors remain) are fetched again after 2, 5 and 15 minutes (ESI's error window resets every minute; the longer waits cover ESI's unstable minutes after downtime), and the run ends `partial` only when some are still missing after that; its detail lists them per region (`failedTypeIds`). The error limit counts errors per source IP, which Cloudflare Workers share, so other ESI users' errors can also lower it. Missed days are not lost: the next run stores every day newer than the newest stored one.

Contingency: if more than half of the `prices` runs of a day end `partial`, lengthen the price cadence to 60 minutes:

1. In `apps/updater/src/config.ts`, set `PRICE_REFRESH_MINUTES = 60`.
2. Run `npx vitest run --project updater`, then deploy the updater.

### ESI daily downtime (10:55 to about 11:10 UTC)

EVE's server, and with it ESI, goes down every day at 11:00 UTC, usually for 5 to 10 minutes. The updater sends no ESI request from 10:55 UTC until a `GET /status` reports more than 100 players on the live server (not VIP mode); it checks at most once per minute per isolate from 11:00 UTC. Fuzzwork, SSO, Hoboleaks, Janice and the history mirror are not gated. Logs to expect:

| Time (UTC)    | Log line                                                                           | Meaning                                                                                     |
| ------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 10:55 to back | `[scheduled] adjusted-prices: skipped (ESI downtime)`, the same for every ESI step | The tick ran only `sde-check`; the skipped steps catch up on the next open tick             |
| 10:55 to back | `[<run id>] step 2/9 region-10000002: waiting for ESI (daily downtime)`            | A workflow step hit the downtime; it sleeps 2 minutes and runs again, its retries untouched |
| from 11:00    | `[esi] still down (no status)`, `[esi] still down (40 players)`, `(VIP mode)`      | A `/status` check found the server not back yet                                             |
| about 11:10   | `[esi] online again: 25000 players`                                                | ESI is open again for the rest of the UTC day (KV `esi:online:<date>`, kept 2 days)         |
| after that    | `[<run id>] step 2/9 region-10000002 (after ESI downtime 3): started`              | The waiting step runs again                                                                 |

A step still waiting after 45 waits (about 90 minutes, `ESI_DOWNTIME_MAX_WAITS`) fails as usual: its job run ends `failed`, an inventory or tracking sync ends `error`. Manual runs from `/admin` that call ESI inline (adjusted prices, cost indices, affiliations) answer "ESI is in its daily downtime (from 10:55 UTC until the server is back); try again later." and their row ends `failed`; buttons that start a workflow start it, and it waits.

Nothing is lost by the skipped ticks: price refreshes, the daily job (any tick from 11:20 UTC), affiliations (the first tick from 12:20 UTC without a finished run that day), inventory and tracking start on the next open tick. Runs that wait out the downtime are not settled as stuck for it: the stale limits (25 minutes for price runs, 15 for inventory and tracking syncs) count only the time outside 10:55 UTC to the moment ESI was confirmed back. To reopen ESI by hand after a long outage, put the KV key `esi:online:<today>` with the current time in unix ms as its value: the gate reads it before every `/status` check, and the stale limits count from that time.

### SDE import failed

A failed validation (fewer than 100 reactions, a reactor without reactions, missing constants, no industry rig or structure bonuses) stops the import without retries and leaves the previous data in place; the `sde` job shows the reason. Download or parse errors retry 3 times, also a failed or timed out Hoboleaks download (`Hoboleaks download failed: HTTP <status> for <url>`) or a Hoboleaks file of an unexpected shape; the previous data stays in place. The hourly check does not start the same build again: after the cause is fixed (or Hoboleaks answers again), use SDE sync **Re-import (force)**. Industry bonuses that cannot be derived from the SDE dogma are skipped and listed as `UNDERIVED_INDUSTRY_BONUS:<type>:<activity>:<attribute>` in the SDE warnings.

### Inventory syncs stuck or failing

One sync per source runs at a time. A source `running` for 15 minutes or more (`INVENTORY_RUN_STALE_MINUTES`) no longer blocks: the next cron tick, or the next sync request for it, marks it `error` ("sync did not finish"), and a new sync can start (from the cron only the next day, since its attempt counts for today). To stop an instance that is still working:

```bash
cd apps/updater
npx wrangler workflows instances list reactions-inventory-sync
npx wrangler workflows instances terminate reactions-inventory-sync <instance id>
```

Source states the user sees on the source (`inventory_sources.last_error`):

- `denied`: personal: the character lacks the feature's scopes or ESI answered 403 (access revoked). Corporation: no character of its reader pool (the characters the user added as "<Corporation> via <Character>") works; the message names each one and why ("needs the Director role", "is not in the corporation", "has an invalid token", "has not allowed Corporation assets"). Adding another character of the corporation through "Add a connection" (`/account/connections`) puts it in the pool. The items are deleted; the daily pass skips denied sources until the user starts a sync again.
- `ok` with notes: a corporation sync fell back to another pool member (the notes say why earlier readers were skipped), and/or "Industry jobs not readable: <character> needs the Factory Manager role" (the corporation's industry jobs answered 403, so formulas installed in its reaction jobs are missing; the assets are synced). Giving the character the role (Directors have it) fixes it at the next sync.
- `error` with "The token of <character> is invalid": the character's token is marked invalid; the user adds the feature again on `/account`. "too many assets": more than 500 asset pages (`INVENTORY_MAX_PAGES`). Other errors are ESI or D1 failures after the step retries; the previous items stay (shown as stale) and the next daily pass tries again.
- "ESI has no newer data for <owner> before <time> UTC.": `Sync now` before the `Expires` time of the last sync (`data_expires_at`); ESI forbids asking earlier, so nothing is started.

Asset and industry job pages are staged in R2 under `inventory-staging/<instance id>/` and deleted when the sync ends; the bucket's lifecycle rule (deploy step) deletes anything left after 1 day.

### Profit tracking syncs

One tracking sync per connection runs at a time; it is independent of the inventory sync. A connection `running` for 15 minutes or more (`TRACKING_RUN_STALE_MINUTES`) no longer blocks: the next cron tick, or the next sync request for it, marks it `error` ("sync did not finish"). To stop an instance that is still working:

```bash
cd apps/updater
npx wrangler workflows instances list reactions-tracking-sync
npx wrangler workflows instances terminate reactions-tracking-sync <instance id>
```

- `denied` connection (`inventory_sources.tracking_last_error`): personal: "<Character> has not allowed Profit tracking". Corporation: "No character can read <owner>: …" with each reader and why ("has not allowed Corporation profit tracking", "is not in the corporation", "has an invalid token"; "no character is set to read it" for an empty pool). The cron skips denied connections until the user starts a sync again.
- Denied stream (`tracking_streams.status = 'denied'`, ESI answered 403): only that stream stops; the others sync. `last_error` names the corporation role the reader lacks: jobs "<Character> needs the Factory Manager role", orders "<Character> needs the Accountant or Trader role", wallet transactions and journal "<Character> needs the Accountant or Junior Accountant role"; contracts and personal streams "ESI denied access". Giving the role (or the scopes again) fixes it at the next sync.
- Stream `error`: "ESI answered HTTP <status> for <what>; the next sync tries again." after the step retries. The connection is `error` only when every fetched stream failed.
- `notBefore`: `UpdaterRpc.triggerTrackingSync` answers `{ notBefore }` (the earliest stream `expires_at`) and starts nothing while every stream is still fresh; ESI forbids asking earlier. A sync that finds no stream due ends without requests.
- Dirty ledgers (`ledger_state.dirty` 1 or 2): a change is waiting (the web marks the ledger dirty before every `rebuildLedger` call), or a rebuild at the end of a sync or through the RPC failed (logged as `[tracking] ledger rebuild of connection <id>: …`, `[rpc] rebuildLedger: …` or `[ledger] rebuild of <user> failed: …`). The cron rebuilds up to 10 per tick; a `tracking` row with `ledgersFailed` above 0 ends `partial`. A rebuild needs KV `dataset:v1`.
- Janice key absent: without the updater secret `JANICE_API_KEY` the `janice` step is skipped and contracts with several item types are split by the contract price rule instead of their appraisal. After adding the key, codes without an appraisal are fetched at the next sync that reads contracts (at most 20 per sync). Failed appraisals are logged as `[tracking] <n> Janice appraisals of connection <id> failed (status <statuses>)`, without the codes, and each code is retried after 6 hours, doubling after each failure in a row up to 30 days.

## Data retention

| Data                                                           | Kept                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `price_snapshots` (every refresh)                              | 90 days; the daily job deletes an older day only once it is rolled up into `price_daily` and fully archived: `archive_manifest.object_count` must be at least the number of refreshes that day, so every refresh has its R2 copy                                                                                            |
| `price_daily`                                                  | Forever                                                                                                                                                                                                                                                                                                                     |
| `esi_market_history`                                           | Forever (the history import replaces rows inside its date range)                                                                                                                                                                                                                                                            |
| `adjusted_price_daily`, `cost_index_daily`, `archive_manifest` | Forever                                                                                                                                                                                                                                                                                                                     |
| R2 `prices/raw/...` and `sde/<build>/dataset.json`             | Forever                                                                                                                                                                                                                                                                                                                     |
| R2 `inventory-staging/...`                                     | Until the sync ends; leftovers 1 day (bucket lifecycle rule)                                                                                                                                                                                                                                                                |
| Private structure hub prices and history                       | Deleted with the hub (last link removed, or admin delete)                                                                                                                                                                                                                                                                   |
| Accounts, characters, links                                    | Until the user removes them or deletes the account                                                                                                                                                                                                                                                                          |
| Inventory sources, locations, items, selections                | Until the user removes the source, its character or the account; items are replaced by each sync                                                                                                                                                                                                                            |
| Profit tracking data (`tracking_streams`, `tracked_*`)         | Until the user removes the connection, its character or the account. The first sync reaches back as far as ESI does: 30 days of wallet transactions, journal and contracts, 90 days of industry jobs. `price_corrections` and the ledger results belong to the account (deleted with it); each rebuild replaces the results |
| Expired `user_sessions` rows                                   | Deleted by the daily job                                                                                                                                                                                                                                                                                                    |
| `job_runs`                                                     | Finished rows older than 90 days (`JOB_RUN_RETENTION_DAYS`) are deleted by the daily job; running rows stay                                                                                                                                                                                                                 |
