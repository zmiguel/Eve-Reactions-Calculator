/**
 * `npm run dev:seeded`: the web dev server (`vite dev`) against the seeded state of `npm run seed:local`
 * (`.wrangler/seeded`) instead of the developer's real data in `.wrangler/state`. Extra arguments go to
 * `vite dev` (e.g. `npm run dev:seeded -- --port 5180`).
 *
 * It runs with a generated `apps/web/wrangler.seeded.jsonc` whose `UPDATER` binding points at
 * `reactions-updater-seeded`, so account and admin actions never reach the developer's own updater
 * (`reactions-updater`, working on `.wrangler/state`). To run an updater on the seeded state too:
 * `npx wrangler dev --name reactions-updater-seeded --test-scheduled --port 8792 --persist-to ../../.wrangler/seeded`
 * from `apps/updater`.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSIST_TO } from './seed-local.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'apps/web');

/** `WRANGLER_PERSIST` for `apps/web/svelte.config.js`: the seeded state's `v3` folder, relative to the web app. */
export const SEEDED_PERSIST = relative(WEB, join(PERSIST_TO, 'v3')).replaceAll('\\', '/');
/** Generated wrangler config of `dev:seeded`, relative to `apps/web` (gitignored). */
export const SEEDED_CONFIG = 'wrangler.seeded.jsonc';
export const SEEDED_UPDATER = 'reactions-updater-seeded';

/** `apps/web/wrangler.jsonc` with the `UPDATER` service renamed to `SEEDED_UPDATER`. */
export function seededConfig(source: string): string {
	const from = '"service": "reactions-updater"';
	if (!source.includes(from)) throw new Error(`apps/web/wrangler.jsonc: ${from} not found`);
	return source.replaceAll(from, `"service": "${SEEDED_UPDATER}"`);
}

if (import.meta.main) {
	writeFileSync(join(WEB, SEEDED_CONFIG), seededConfig(readFileSync(join(WEB, 'wrangler.jsonc'), 'utf8')));
	const child = spawn(['npm', 'run', 'dev', '--', ...process.argv.slice(2)].join(' '), {
		cwd: WEB,
		stdio: 'inherit',
		shell: true,
		env: { ...process.env, WRANGLER_PERSIST: SEEDED_PERSIST, WRANGLER_CONFIG: SEEDED_CONFIG }
	});
	child.on('exit', (code) => process.exit(code ?? 0));
}
