/**
 * End-to-end server: a fresh local state in `.wrangler/e2e` (never the dev state in `.wrangler/state`),
 * the seed, a production build of the web app and `wrangler dev` of the built worker with test-only
 * secrets. Usage: `npm run e2e:server` (Playwright starts it through `webServer`).
 *
 * It builds and serves from its own wrangler config (`apps/web/wrangler.e2e.jsonc`, generated): output in
 * `.svelte-kit/cloudflare-e2e`, so a running `npm run dev` holding `.svelte-kit/cloudflare` open cannot
 * fail the build, and the `UPDATER` binding pointing at `reactions-updater-e2e`, so admin actions never
 * reach a developer's local updater (which runs as `reactions-updater` against the dev state).
 */
import { execSync, spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_TOKEN_ENCRYPTION_KEY, seedLocal } from './seed-local.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'apps/web');
export const E2E_PERSIST_TO = join(ROOT, '.wrangler/e2e');
export const E2E_PORT = 8790;
/** Generated wrangler config of the e2e build, relative to `apps/web`. */
export const E2E_CONFIG = 'wrangler.e2e.jsonc';
const E2E_OUTPUT = '.svelte-kit/cloudflare-e2e';

/** `apps/web/wrangler.jsonc` with the e2e build output and an updater service name no dev process uses. */
export function e2eConfig(source: string): string {
	const replacements: [string, string][] = [
		['".svelte-kit/cloudflare/_worker.js"', `"${E2E_OUTPUT}/_worker.js"`],
		['"directory": ".svelte-kit/cloudflare"', `"directory": "${E2E_OUTPUT}"`],
		['"service": "reactions-updater"', '"service": "reactions-updater-e2e"']
	];
	return replacements.reduce((text, [from, to]) => {
		if (!text.includes(from)) throw new Error(`apps/web/wrangler.jsonc: ${from} not found`);
		return text.replace(from, to);
	}, source);
}

/** Overrides `apps/web/.dev.vars`: the seed's token key, dev login, and Seed Pilot (90000001) as the only admin. */
export const E2E_VARS: Record<string, string> = {
	DEV_LOGIN: '1',
	ADMIN_CHARACTER_IDS: '90000001',
	TOKEN_ENCRYPTION_KEY: DEV_TOKEN_ENCRYPTION_KEY,
	// base64 of 32 ASCII bytes (the format `hmacKey` requires); used only by the e2e server.
	SESSION_SECRET: btoa('e2e-session-secret-32-bytes-long'),
	EVE_SSO_CLIENT_ID: 'e2e',
	EVE_SSO_CLIENT_SECRET: 'e2e',
	EVE_SSO_CALLBACK_URL: `http://localhost:${E2E_PORT}/auth/callback`
};

/** `wrangler dev` arguments serving the built worker on `E2E_PORT` from `E2E_PERSIST_TO`. */
export function wranglerDevArgs(): string[] {
	return [
		'dev',
		'-c',
		E2E_CONFIG,
		'--port',
		String(E2E_PORT),
		'--persist-to',
		E2E_PERSIST_TO,
		...Object.entries(E2E_VARS).flatMap(([key, value]) => ['--var', `${key}:${value}`])
	];
}

if (import.meta.main) {
	rmSync(E2E_PERSIST_TO, { recursive: true, force: true });
	await seedLocal(E2E_PERSIST_TO);
	writeFileSync(join(WEB, E2E_CONFIG), e2eConfig(readFileSync(join(WEB, 'wrangler.jsonc'), 'utf8')));
	// A stale adapter output can make the Windows build fail with EPERM.
	rmSync(join(WEB, E2E_OUTPUT), { recursive: true, force: true });
	execSync('npm run build -w apps/web', {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, WRANGLER_CONFIG: E2E_CONFIG }
	});
	const wrangler = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
	const server = spawn(process.execPath, [wrangler, ...wranglerDevArgs()], { cwd: WEB, stdio: 'inherit' });
	const stop = () => server.kill();
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
	server.on('exit', (code) => process.exit(code ?? 0));
}
