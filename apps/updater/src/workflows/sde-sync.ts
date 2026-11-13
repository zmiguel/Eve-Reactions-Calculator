import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import {
	DATASET_KV_KEY,
	getCoreDb,
	httpCache,
	regions,
	sdeState,
	systems,
	types,
	upsertMany
} from '@reactions/db';
import { DEFAULT_CONSTANTS, REACTORS } from '@reactions/engine';
import { parseSdeZip, readIndustrySources } from '@reactions/sde';
import type { IndustrySources, SdeDataset } from '@reactions/sde';
import { eq } from 'drizzle-orm';
import {
	HOBOLEAKS_MODIFIER_SOURCES_URL,
	HOBOLEAKS_TARGET_FILTERS_URL,
	HOBOLEAKS_TIMEOUT_MS,
	SDE_ARCHIVE_KEY,
	SDE_MIN_REACTIONS,
	SDE_ZIP_URL,
	STEP_CONFIG
} from '../config.ts';
import { MARKET_PRICES_URL } from '../cron/adjusted-prices.ts';
import { httpFetch, userAgent } from '../http.ts';
import { failJobRun, finishJobRun, startJobRun } from '../jobs.ts';
import { jsonInsertSql, upsertClause } from '../prices.ts';
import { StepTracker } from '../progress.ts';

export interface SdeSyncParams {
	build: number;
}

export interface SdeCounts {
	build: number;
	releaseDate: string;
	reactions: number;
	types: number;
	regions: number;
	systems: number;
	warnings: number;
}

/** Paths of `DEFAULT_CONSTANTS` leaves that are not finite numbers in `actual`. */
function missingConstants(expected: object, actual: unknown, prefix = ''): string[] {
	const missing: string[] = [];
	for (const [key, value] of Object.entries(expected)) {
		const found: unknown =
			actual !== null && typeof actual === 'object' ? Reflect.get(actual, key) : undefined;
		if (typeof value === 'number') {
			if (typeof found !== 'number' || !Number.isFinite(found)) missing.push(prefix + key);
		} else if (value !== null && typeof value === 'object') {
			missing.push(...missingConstants(value, found, `${prefix}${key}.`));
		}
	}
	return missing;
}

/** Reasons the dataset must not be imported (empty when valid). */
export function validateSdeDataset(sde: SdeDataset): string[] {
	const problems: string[] = [];
	const { reactions: list, constants } = sde.dataset;
	if (list.length < SDE_MIN_REACTIONS)
		problems.push(`only ${list.length} reactions (minimum ${SDE_MIN_REACTIONS})`);
	for (const reactor of REACTORS)
		if (!list.some((r) => r.reactor === reactor)) problems.push(`no ${reactor} reactions`);
	const missing = missingConstants(DEFAULT_CONSTANTS, constants);
	if (missing.length > 0) problems.push(`constants missing: ${missing.join(', ')}`);
	const industry = sde.dataset.industry;
	if (!industry?.rigs.length || !industry.structures.length)
		problems.push('no industry rig or structure bonuses');
	return problems;
}

/** Downloads the Hoboleaks industry files; an HTTP error, a timeout or an unexpected shape throws. */
export async function fetchIndustrySources(env: Env): Promise<IndustrySources> {
	const download = async (url: string): Promise<unknown> => {
		const response = await httpFetch(url, {
			headers: { 'User-Agent': userAgent(env) },
			signal: AbortSignal.timeout(HOBOLEAKS_TIMEOUT_MS)
		});
		if (!response.ok) throw new Error(`Hoboleaks download failed: HTTP ${response.status} for ${url}`);
		return response.json();
	};
	const [modifierSources, targetFilters] = await Promise.all([
		download(HOBOLEAKS_MODIFIER_SOURCES_URL),
		download(HOBOLEAKS_TARGET_FILTERS_URL)
	]);
	return readIndustrySources(modifierSources, targetFilters);
}

async function readArchivedSde(env: Env, build: number): Promise<SdeDataset> {
	const object = await env.ARCHIVE.get(SDE_ARCHIVE_KEY(build));
	if (!object) throw new Error(`R2 object ${SDE_ARCHIVE_KEY(build)} missing`);
	return object.json<SdeDataset>();
}

/**
 * Step `download-parse`: download the Hoboleaks industry files and the SDE archive, parse and validate
 * them, keep the dataset in R2.
 */
export async function downloadAndParse(env: Env, build: number): Promise<SdeCounts> {
	const industry = await fetchIndustrySources(env);
	const response = await httpFetch(SDE_ZIP_URL(build), { headers: { 'User-Agent': userAgent(env) } });
	if (!response.ok || !response.body) throw new Error(`SDE archive download failed: HTTP ${response.status}`);
	const sde = await parseSdeZip(response.body, { industry });
	const problems = validateSdeDataset(sde);
	if (problems.length > 0)
		throw new NonRetryableError(`SDE build ${build} failed validation: ${problems.join('; ')}`);
	await env.ARCHIVE.put(SDE_ARCHIVE_KEY(build), JSON.stringify(sde), {
		httpMetadata: { contentType: 'application/json' }
	});
	return {
		build: sde.build,
		releaseDate: sde.releaseDate,
		reactions: sde.dataset.reactions.length,
		types: sde.types.length,
		regions: sde.regions.length,
		systems: sde.systems.length,
		warnings: sde.warnings.length
	};
}

/** Step `write-reference`: upsert `types`, `regions`, `systems`. */
export async function writeReference(env: Env, build: number): Promise<void> {
	const sde = await readArchivedSde(env, build);
	const db = getCoreDb(env.DB);
	await upsertMany(
		db,
		types,
		sde.types.map((t) => ({
			typeId: t.typeId,
			name: t.name,
			groupId: t.groupId,
			categoryId: t.categoryId,
			volume: t.volume,
			portionSize: t.portionSize,
			published: t.published,
			basePrice: t.basePrice
		})),
		[types.typeId],
		[
			types.name,
			types.groupId,
			types.categoryId,
			types.volume,
			types.portionSize,
			types.published,
			types.basePrice
		]
	);
	await upsertMany(db, regions, sde.regions, [regions.regionId], [regions.name]);
	await upsertMany(
		db,
		systems,
		sde.systems,
		[systems.systemId],
		[systems.name, systems.regionId, systems.securityStatus, systems.securityBand]
	);
}

/**
 * A table `writeReactions` makes equal to the build: `columns` in row order, `keys` = primary key,
 * `match` = the columns a stored row must share with an incoming row to be kept (default `keys`;
 * `reactions` adds its UNIQUE columns, so a slug or product moving between formulas is deleted and
 * inserted instead of tripping the constraint in an upsert).
 */
interface ReplacedTable {
	table: string;
	columns: readonly string[];
	keys: readonly string[];
	match?: readonly string[];
}

const REACTIONS_TABLE: ReplacedTable = {
	table: 'reactions',
	columns: [
		'blueprint_type_id',
		'slug',
		'formula_name',
		'name',
		'product_type_id',
		'product_quantity',
		'reactor',
		'tier',
		'base_time_seconds',
		'max_runs',
		'required_skill_level'
	],
	keys: ['blueprint_type_id'],
	match: ['blueprint_type_id', 'slug', 'product_type_id']
};
const MATERIAL_COLUMNS = ['blueprint_type_id', 'type_id', 'quantity'] as const;
const MATERIAL_KEYS = ['blueprint_type_id', 'type_id'] as const;
const REACTION_MATERIALS_TABLE: ReplacedTable = {
	table: 'reaction_materials',
	columns: MATERIAL_COLUMNS,
	keys: MATERIAL_KEYS
};
const REPROCESS_TABLE: ReplacedTable = {
	table: 'reprocess_materials',
	columns: ['type_id', 'material_type_id', 'quantity', 'quantity_min', 'quantity_max', 'portion_size'],
	keys: ['type_id', 'material_type_id']
};
const MATERIAL_BLUEPRINT_MATERIALS_TABLE: ReplacedTable = {
	table: 'material_blueprint_materials',
	columns: MATERIAL_COLUMNS,
	keys: MATERIAL_KEYS
};
const MANUFACTURING_BLUEPRINTS_TABLE: ReplacedTable = {
	table: 'manufacturing_blueprints',
	columns: ['blueprint_type_id', 'name', 'product_type_id', 'product_name', 'product_filters_json'],
	keys: ['blueprint_type_id']
};
const MANUFACTURING_MATERIALS_TABLE: ReplacedTable = {
	table: 'manufacturing_blueprint_materials',
	columns: MATERIAL_COLUMNS,
	keys: MATERIAL_KEYS
};

/** Rows per upsert statement (each statement carries its rows as one JSON parameter). */
const SDE_ROWS_PER_STATEMENT = 500;

/**
 * Statements making `table` equal to `rows` (arrays in `columns` order): stored rows without an
 * incoming row sharing their `match` columns are deleted (both sides rendered with `json_array`, so
 * they compare equal exactly when the values do), then the rows are upserted, a stored row rewritten
 * only when a value differs. An unchanged build writes nothing.
 */
function replaceTable(
	db: D1Database,
	spec: ReplacedTable,
	rows: readonly unknown[][]
): D1PreparedStatement[] {
	const { table, columns, keys } = spec;
	const match = spec.match ?? keys;
	const at = match.map((c) => columns.indexOf(c));
	const incoming = match.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ');
	const statements = [
		db
			.prepare(
				`DELETE FROM ${table} WHERE json_array(${match.join(', ')}) NOT IN (
					SELECT json_array(${incoming}) FROM json_each(?1))`
			)
			.bind(JSON.stringify(rows.map((row) => at.map((i) => row[i]))))
	];
	const upsert = jsonInsertSql(table, columns, upsertClause(table, columns, keys));
	for (let i = 0; i < rows.length; i += SDE_ROWS_PER_STATEMENT)
		statements.push(db.prepare(upsert).bind(JSON.stringify(rows.slice(i, i + SDE_ROWS_PER_STATEMENT))));
	return statements;
}

/**
 * Step `write-reactions`: makes `reactions`, `reaction_materials`, `reprocess_materials`,
 * `material_blueprint_materials`, `manufacturing_blueprints` and `manufacturing_blueprint_materials`
 * equal to the build in one batch (`replaceTable`: only new, changed and removed rows are written).
 */
export async function writeReactions(env: Env, build: number): Promise<void> {
	const { dataset, manufacturingBlueprints: consuming } = await readArchivedSde(env, build);
	const reactionRows = dataset.reactions.map((r) => [
		r.blueprintTypeId,
		r.slug,
		r.formulaName,
		r.name,
		r.product.typeId,
		r.product.quantity,
		r.reactor,
		r.tier,
		r.baseTimeSeconds,
		r.maxRuns,
		r.requiredSkillLevel
	]);
	const materialRows = dataset.reactions.flatMap((r) =>
		r.materials.map((m) => [r.blueprintTypeId, m.typeId, m.quantity])
	);
	const reprocessRows = Object.values(dataset.reprocess).flatMap((entry) =>
		entry.materials.map((m) => [
			entry.typeId,
			m.typeId,
			m.quantity,
			m.quantityMin,
			m.quantityMax,
			entry.portionSize
		])
	);
	const blueprintMaterialRows = (dataset.manufacturing ?? [])
		.filter((bp) => bp.makes === 'material')
		.flatMap((bp) => bp.materials.map((m) => [bp.blueprintTypeId, m.typeId, m.quantity]));
	const consumingRows = consuming.map((bp) => [
		bp.blueprintTypeId,
		bp.name,
		bp.productTypeId,
		bp.productName,
		JSON.stringify(bp.productFilters)
	]);
	const consumingMaterialRows = consuming.flatMap((bp) =>
		bp.materials.map((m) => [bp.blueprintTypeId, m.typeId, m.quantity])
	);
	await env.DB.batch([
		...replaceTable(env.DB, REACTIONS_TABLE, reactionRows),
		...replaceTable(env.DB, REACTION_MATERIALS_TABLE, materialRows),
		...replaceTable(env.DB, REPROCESS_TABLE, reprocessRows),
		...replaceTable(env.DB, MATERIAL_BLUEPRINT_MATERIALS_TABLE, blueprintMaterialRows),
		...replaceTable(env.DB, MANUFACTURING_BLUEPRINTS_TABLE, consumingRows),
		...replaceTable(env.DB, MANUFACTURING_MATERIALS_TABLE, consumingMaterialRows)
	]);
}

/** Step `publish`: KV `dataset:v1`, `sde_state`, `job_runs` → ok. */
export async function publishSde(env: Env, build: number, runId: string, counts: SdeCounts): Promise<void> {
	const sde = await readArchivedSde(env, build);
	const db = getCoreDb(env.DB);
	await env.CACHE.put(DATASET_KV_KEY, JSON.stringify(sde.dataset));
	const state = {
		buildNumber: sde.build,
		releaseDate: sde.releaseDate,
		importedAt: Date.now(),
		constantsJson: JSON.stringify(sde.dataset.constants),
		warningsJson: JSON.stringify(sde.warnings)
	};
	await db.batch([
		db
			.insert(sdeState)
			.values({ id: 1, ...state })
			.onConflictDoUpdate({ target: sdeState.id, set: state }),
		// The tracked type set may have changed: fetch every adjusted price again on the next tick.
		db.delete(httpCache).where(eq(httpCache.url, MARKET_PRICES_URL))
	]);
	await finishJobRun(env, runId, 'ok', counts);
}

/** Imports SDE build `params.build`: instance id `sde-<build>` (cron) or `sde-<build>-manual-<ms>`. */
export class SdeSyncWorkflow extends WorkflowEntrypoint<Env, SdeSyncParams> {
	override async run(event: Readonly<WorkflowEvent<SdeSyncParams>>, step: WorkflowStep): Promise<SdeCounts> {
		const { build } = event.payload;
		const runId = event.instanceId;
		const startedAt = event.timestamp.getTime();
		await startJobRun(this.env, runId, 'sde', startedAt);
		const steps = new StepTracker(this.env, step, runId);
		steps.total = 4;
		try {
			const counts = await steps.do('download-parse', STEP_CONFIG, () => downloadAndParse(this.env, build));
			await steps.do('write-reference', STEP_CONFIG, () => writeReference(this.env, build));
			await steps.do('write-reactions', STEP_CONFIG, () => writeReactions(this.env, build));
			await steps.do('publish', STEP_CONFIG, () => publishSde(this.env, build, runId, counts));
			return counts;
		} catch (error) {
			await failJobRun(this.env, runId, 'sde', startedAt, error);
			throw error;
		}
	}
}
