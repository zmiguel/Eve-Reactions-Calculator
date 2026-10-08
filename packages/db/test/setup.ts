import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.CORE_MIGRATIONS);
await applyD1Migrations(env.HISTORY_DB, env.HISTORY_MIGRATIONS);
