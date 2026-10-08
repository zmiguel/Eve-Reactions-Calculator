/**
 * Miniflare-free bindings for `web-unit` tests: D1 over Node's built-in SQLite (with the real
 * migrations applied), an in-memory KV namespace and a SvelteKit-compatible cookie jar.
 */
import type { Cookies } from '@sveltejs/kit';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const migrationsRoot = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url));

function applyMigrations(db: DatabaseSync, dir: 'core' | 'history') {
	const path = migrationsRoot + dir;
	for (const file of readdirSync(path)
		.filter((f) => f.endsWith('.sql'))
		.sort()) {
		for (const statement of readFileSync(`${path}/${file}`, 'utf8').split('--> statement-breakpoint')) {
			if (statement.trim()) db.exec(statement);
		}
	}
}

type Bindable = SQLInputValue | boolean | undefined;
const toSqlite = (values: Bindable[]): SQLInputValue[] =>
	values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));

class FakeStatement {
	constructor(
		private db: FakeD1,
		readonly sql: string,
		private params: SQLInputValue[] = []
	) {}

	bind(...values: Bindable[]) {
		return new FakeStatement(this.db, this.sql, toSqlite(values));
	}

	private prepared() {
		this.db.log.push(this.sql);
		return this.db.sqlite.prepare(this.sql);
	}

	async all<T = Record<string, unknown>>() {
		const stmt = this.prepared();
		if (stmt.columns().length === 0) {
			const info = stmt.run(...this.params);
			return { results: [] as T[], success: true, meta: { changes: Number(info.changes) } };
		}
		return { results: stmt.all(...this.params) as T[], success: true, meta: { changes: 0 } };
	}

	async raw<T = unknown[]>(opts?: { columnNames?: boolean }) {
		const stmt = this.prepared();
		if (stmt.columns().length === 0) {
			stmt.run(...this.params);
			return [] as T[];
		}
		stmt.setReturnArrays(true);
		const rows = stmt.all(...this.params) as T[];
		return opts?.columnNames ? [stmt.columns().map((c) => c.name) as T, ...rows] : rows;
	}

	async first<T = Record<string, unknown>>(column?: string) {
		const row = (await this.all<Record<string, unknown>>()).results[0];
		if (!row) return null;
		return (column ? row[column] : row) as T;
	}

	async run() {
		const info = this.prepared().run(...this.params);
		return {
			success: true,
			results: [],
			meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
		};
	}
}

export class FakeD1 {
	readonly sqlite = new DatabaseSync(':memory:');
	readonly log: string[] = [];

	constructor(kind: 'core' | 'history') {
		this.sqlite.exec('PRAGMA foreign_keys = ON');
		applyMigrations(this.sqlite, kind);
	}

	prepare(sql: string) {
		return new FakeStatement(this, sql);
	}

	async batch(statements: FakeStatement[]) {
		this.sqlite.exec('BEGIN');
		try {
			const results = [];
			for (const s of statements) results.push(await s.all());
			this.sqlite.exec('COMMIT');
			return results;
		} catch (e) {
			this.sqlite.exec('ROLLBACK');
			throw e;
		}
	}

	async exec(sql: string) {
		this.sqlite.exec(sql);
		return { count: 1, duration: 0 };
	}

	/** Test helper: synchronous SELECT. */
	rows<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
		return this.sqlite.prepare(sql).all(...params) as T[];
	}
}

export class FakeKV {
	readonly store = new Map<string, string>();
	gets = 0;

	async get(key: string, opts?: { type?: string; cacheTtl?: number } | string) {
		this.gets++;
		const value = this.store.get(key);
		if (value === undefined) return null;
		const type = typeof opts === 'string' ? opts : opts?.type;
		return type === 'json' ? JSON.parse(value) : value;
	}

	async put(key: string, value: string) {
		this.store.set(key, value);
	}

	async delete(key: string) {
		this.store.delete(key);
	}
}

export interface FakeEnv {
	DB: FakeD1;
	HISTORY_DB: FakeD1;
	CACHE: FakeKV;
	ADMIN_CHARACTER_IDS: string;
	[key: string]: unknown;
}

export function fakeEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
	return {
		DB: new FakeD1('core'),
		HISTORY_DB: new FakeD1('history'),
		CACHE: new FakeKV(),
		ADMIN_CHARACTER_IDS: '',
		...overrides
	};
}

/** Casts a fake env to the worker `Env` type for code under test. */
export const asEnv = (env: FakeEnv) => env as unknown as Env;

export interface SetCookie {
	name: string;
	value: string;
	opts: Record<string, unknown>;
}

export class FakeCookies {
	readonly jar = new Map<string, string>();
	readonly set_calls: SetCookie[] = [];
	readonly deleted: string[] = [];

	constructor(initial: Record<string, string> = {}) {
		for (const [k, v] of Object.entries(initial)) this.jar.set(k, v);
	}

	get(name: string) {
		return this.jar.get(name);
	}

	getAll() {
		return [...this.jar].map(([name, value]) => ({ name, value }));
	}

	set(name: string, value: string, opts: Record<string, unknown>) {
		this.jar.set(name, value);
		this.set_calls.push({ name, value, opts });
	}

	delete(name: string, opts: Record<string, unknown>) {
		this.jar.delete(name);
		this.deleted.push(name);
		this.set_calls.push({ name, value: '', opts: { ...opts, maxAge: 0 } });
	}

	serialize(name: string, value: string) {
		return `${name}=${value}`;
	}

	asCookies() {
		return this as unknown as Cookies;
	}
}
