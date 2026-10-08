# EVE Reactions Calculator v3

Live profitability of every EVE Online reaction at [reactions.coalition.space](https://reactions.coalition.space). Prices come from ESI market orders (Fuzzwork as fallback) and refresh every 30 minutes; reaction data comes from the official SDE. It runs on Cloudflare Workers with D1, KV, R2 and Workflows, and is a rewrite of the v2 site.

## Features

- Composite, biochemical (including Molecular-Forged) and hybrid listings by tier, sortable, with profit per slot-day, margin, input cost, output value and job cost.
- Reaction detail: buy-inputs or full-chain production (an intermediate is made with its Unrefined reaction and reprocessing when that pays better), reprocessed output, material flow, production steps, optimal slot allocation across parallel lines, price timing (inputs bought N days ago) and history charts.
- Home page with the best final products per reactor over the last 7 days (profitable days, market size in slots) and input price moves.
- Settings for structure, rigs, system, taxes, skill, market hubs, buy/sell methods and shipping, shared or per reactor; stored as a small cookie, synced to the account when logged in, shareable as a link.
- Planner: slot targets, auto-fill, stock and owned formulas, shopping lists with market availability, multibuy copy and share links.
- EVE SSO accounts with several characters; structure markets as private hubs, optionally shared after admin review.
- Public API v2 with JSON and CSV (Google Sheets `IMPORTDATA`), OpenAPI document and interactive reference at `/api`.
- Price history kept indefinitely: refresh snapshots for 90 days, daily aggregates and ESI regional history forever, raw archives in R2.
- Dark mode by default; v2 reaction URLs answer 301 to their new pages, API v1 answers 410.

## Repository layout

| Path              | Contents                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web`        | SvelteKit app, worker `reactions-web`: pages, API v2, accounts, admin                          |
| `apps/updater`    | Worker `reactions-updater`: cron, price/daily/SDE/history workflows, `UpdaterRpc`              |
| `packages/engine` | `@reactions/engine`: settings schema, formulas, calculator, slot allocation, sourcing, planner |
| `packages/sde`    | `@reactions/sde`: streaming SDE zip parser and normalizer                                      |
| `packages/db`     | `@reactions/db`: Drizzle schemas, D1 migrations (core and history), KV types                   |
| `packages/eve`    | `@reactions/eve`: ESI, SSO, Fuzzwork and market.coalition.space clients, token crypto, scopes  |
| `scripts`         | Local seed, e2e server, dev cron, SDE fixture and OG image generators                          |

## Quick start

Requires Node.js 26+.

```bash
npm ci
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/updater/.dev.vars.example apps/updater/.dev.vars
# set SESSION_SECRET in apps/web/.dev.vars:
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
npm run seed:local        # overwrites .wrangler/state with fixture data
npm run dev -w apps/web   # http://localhost:5173
```

Optional, in two more terminals: `npm run dev -w apps/updater` and `npm run dev:cron -w apps/updater` (live data, cron every 10 minutes). Log in without EVE SSO at `http://localhost:5173/auth/dev-login?characterId=90000001` (admin with the example `.dev.vars`). Details in [docs/development.md](docs/development.md).

## Common commands

| Command                             | Purpose                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run lint`                      | ESLint and Prettier check                                                                     |
| `npm run format`                    | Prettier write                                                                                |
| `npm run check`                     | Type checks (svelte-check, tsc)                                                               |
| `npm test`                          | All vitest projects                                                                           |
| `npx vitest run --project <name>`   | One project: `engine`, `sde`, `db`, `eve`, `updater`, `web-unit`, `web-components`, `scripts` |
| `npm run build -w apps/web`         | Production build of the web app                                                               |
| `npm run test:e2e`                  | Playwright on an isolated seeded server (port 8790)                                           |
| `npm run lhci`                      | Lighthouse CI on `/` and `/composite`                                                         |
| `npm run db:generate`               | Generate migrations from the Drizzle schemas                                                  |
| `npm run db:migrate:local`          | Apply migrations to the local D1 databases                                                    |
| `npm run check:legacy -- <baseUrl>` | Check every v2 URL of a deployed site (301 then 200)                                          |

## Documentation

- [Architecture](docs/architecture.md): components, data flow, databases, KV and R2, settings, accounts, pipelines, engine.
- [Development](docs/development.md): local setup, `.dev.vars`, seeding, running both workers, tests.
- [Deployment](docs/deploy.md): Cloudflare runbook from zero to the Worker Preview (live data only), then the production cutover, rollback, routine operations.
- [Operations](docs/operations.md): admin pages, jobs and schedule, troubleshooting, data retention.
- [Changelog](CHANGELOG.md): what changed from v2 to v3.
