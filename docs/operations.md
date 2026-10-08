# Operations

Day-to-day running of the production site. Deployment and rollback are in [deploy.md](deploy.md); data flow in [architecture.md](architecture.md).

## Admin access

Admins are the accounts that hold a character listed in `ADMIN_CHARACTER_IDS` (`apps/web/wrangler.jsonc`). Log in with EVE SSO; the account menu then shows **Admin**. Everyone else gets a plain 404 on the admin pages. Both pages are `noindex`.

Admin rights are bound to character ids only. Before an admin character is transferred or sold, remove its id from `ADMIN_CHARACTER_IDS` and redeploy the web app; otherwise the new owner becomes an admin at their next login.

Never use the dev `TOKEN_ENCRYPTION_KEY` from `.dev.vars.example` in production: it is public in the repository.

## `/admin`

| Section                    | Shows                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Jobs                       | One row per job of the registry (`apps/web/src/lib/admin/jobs.ts`), also before its first run ("Never run"): latest run with how it was started (cron, manual, retry), status (`running`, `ok`, `partial`, `failed`), start, duration (or "running N"), detail (error message, else counts), the run button(s) and **History** |
| SDE                        | Imported build, release date, import time                                                                                                                                                                                                                                                                                      |
| Latest prices by source    | Row count of `latest_prices` per source (`esi`, `esi_structure`, `fuzzwork`) and total                                                                                                                                                                                                                                         |
| Structure hubs with errors | Structure hubs whose `last_error` is set, with the error and last success                                                                                                                                                                                                                                                      |

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

| Job (`job_runs.kind`)               | Schedule                                                                                                                           | What it does                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adjusted prices (`adjusted_prices`) | Every tick, fetches only when the cached ESI response expired                                                                      | ESI `/markets/prices` into `adjusted_prices` (tracked types), republishes `market:v1`                                                                                              |
| Cost indices (`cost_indices`)       | Every tick, fetches only when the cached ESI response expired                                                                      | ESI `/industry/systems` into `cost_indices`, republishes `market:v1`                                                                                                               |
| Price refresh (`prices`)            | Every 30 minutes (`PRICE_REFRESH_MINUTES`), workflow `reactions-price-refresh`                                                     | Orders of every tracked type at every enabled hub (ESI, Fuzzwork fallback), structure markets, `latest_prices`, `price_snapshots`, KV `market:v1`, R2 archive                      |
| SDE sync (`sde`)                    | Checked hourly (minutes 0 to 9), workflow `reactions-sde-sync` when a new build exists                                             | Downloads and parses the SDE, replaces reference and reaction tables, KV `dataset:v1`                                                                                              |
| Daily (`daily`)                     | Once per day from 11:20 UTC, workflow `reactions-daily`; waits until the first SDE import exists (`skipped (no SDE imported yet)`) | New ESI regional history days, market stats, yesterday's `price_daily`, today's index snapshots, archive check, snapshot retention, pruning of old `job_runs` and expired sessions |
| Market history import (`history`)   | Manual only (`/admin`)                                                                                                             | Replaces regional history from 2025-02-01 with market.coalition.space data, recomputes market stats                                                                                |

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

- A character's token is marked invalid (expired grant, revoked access, unreadable token): the user enables structure markets again on `/account`. `last_error` starting with `SSO_APP_UNKNOWN` means the token came from an EVE SSO application whose id or secret the worker lacks: check `EVE_SSO_CLIENT_ID`/`EVE_SSO_EXTRA_CLIENT_ID` and their secrets on the updater and both web deployments.
- `NO_CONTRIBUTOR`: the last user linked to a public structure hub left; the hub is disabled. Delete it on `/admin/hubs` or wait for a user to link it again (adding re-enables it).
- Private structure hubs are refreshed only while a linked user was seen in the last 30 days.
- A structure hub deleted while a price refresh is running is skipped by that run; it does not fail the run.

### ESI throttling

The ESI client tracks rate-limit and error-limit headers. When fewer than 10 % of the rate limit remain, fewer than 20 errors remain, or ESI answers 420 or 429, the remaining types of that region step are priced from Fuzzwork instead and the run ends `partial`. Requests that fail with 5xx, 420 or 429 are retried once, honouring `Retry-After` up to 30 seconds (`MAX_RETRY_WAIT_SECONDS` in `packages/eve/src/esi.ts`); a longer `Retry-After` is not waited out, the response goes straight to the guard and the Fuzzwork fallback.

Contingency: if more than half of the `prices` runs of a day end `partial`, lengthen the price cadence to 60 minutes:

1. In `apps/updater/src/config.ts`, set `PRICE_REFRESH_MINUTES = 60`.
2. Run `npx vitest run --project updater`, then deploy the updater.

### SDE import failed

A failed validation (fewer than 100 reactions, a reactor without reactions, missing constants) stops the import without retries and leaves the previous data in place; the `sde` job shows the reason. Download or parse errors retry 3 times. After the cause is fixed, use SDE sync **Re-import (force)**.

## Data retention

| Data                                                           | Kept                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `price_snapshots` (every refresh)                              | 90 days; the daily job deletes an older day only once it is rolled up into `price_daily` and fully archived: `archive_manifest.object_count` must be at least the number of refreshes that day, so every refresh has its R2 copy |
| `price_daily`                                                  | Forever                                                                                                                                                                                                                          |
| `esi_market_history`                                           | Forever (the history import replaces rows inside its date range)                                                                                                                                                                 |
| `adjusted_price_daily`, `cost_index_daily`, `archive_manifest` | Forever                                                                                                                                                                                                                          |
| R2 `prices/raw/...` and `sde/<build>/dataset.json`             | Forever                                                                                                                                                                                                                          |
| Private structure hub prices and history                       | Deleted with the hub (last link removed, or admin delete)                                                                                                                                                                        |
| Accounts, characters, links                                    | Until the user removes them or deletes the account                                                                                                                                                                               |
| Expired `user_sessions` rows                                   | Deleted by the daily job                                                                                                                                                                                                         |
| `job_runs`                                                     | Finished rows older than 90 days (`JOB_RUN_RETENTION_DAYS`) are deleted by the daily job; running rows stay                                                                                                                      |
