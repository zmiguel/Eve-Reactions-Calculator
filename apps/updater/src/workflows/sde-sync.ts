import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import {
	chunkRows,
	DATASET_KV_KEY,
	getCoreDb,
	httpCache,
	manufacturingBlueprintMaterials,
	manufacturingBlueprints,
	materialBlueprintMaterials,
	reactionMaterials,
	reactions,
	regions,
	reprocessMaterials,
	sdeState,
	systems,
	types,
	upsertMany
} from '@reactions/db';
import { DEFAULT_CONSTANTS, REACTORS } from '@reactions/engine';
import { parseSdeZip, readIndustrySources } from '@reactions/sde';
import type { IndustrySources, SdeDataset } from '@reactions/sde';
import type { BatchItem } from 'drizzle-orm/batch';
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
 * Step `write-reactions`: replace `reactions`, `reaction_materials`, `reprocess_materials`,
 * `material_blueprint_materials`, `manufacturing_blueprints` and `manufacturing_blueprint_materials` in
 * one batch.
 */
export async function writeReactions(env: Env, build: number): Promise<void> {
	const { dataset, manufacturingBlueprints: consuming } = await readArchivedSde(env, build);
	const db = getCoreDb(env.DB);
	const reactionRows = dataset.reactions.map((r) => ({
		blueprintTypeId: r.blueprintTypeId,
		slug: r.slug,
		formulaName: r.formulaName,
		name: r.name,
		productTypeId: r.product.typeId,
		productQuantity: r.product.quantity,
		reactor: r.reactor,
		tier: r.tier,
		baseTimeSeconds: r.baseTimeSeconds,
		maxRuns: r.maxRuns,
		requiredSkillLevel: r.requiredSkillLevel
	}));
	const materialRows = dataset.reactions.flatMap((r) =>
		r.materials.map((m) => ({ blueprintTypeId: r.blueprintTypeId, typeId: m.typeId, quantity: m.quantity }))
	);
	const reprocessRows = Object.values(dataset.reprocess).flatMap((entry) =>
		entry.materials.map((m) => ({
			typeId: entry.typeId,
			materialTypeId: m.typeId,
			quantity: m.quantity,
			quantityMin: m.quantityMin,
			quantityMax: m.quantityMax,
			portionSize: entry.portionSize
		}))
	);
	const blueprintMaterialRows = (dataset.manufacturing ?? [])
		.filter((bp) => bp.makes === 'material')
		.flatMap((bp) =>
			bp.materials.map((m) => ({
				blueprintTypeId: bp.blueprintTypeId,
				typeId: m.typeId,
				quantity: m.quantity
			}))
		);
	const consumingRows = consuming.map((bp) => ({
		blueprintTypeId: bp.blueprintTypeId,
		name: bp.name,
		productTypeId: bp.productTypeId,
		productName: bp.productName,
		productFiltersJson: JSON.stringify(bp.productFilters)
	}));
	const consumingMaterialRows = consuming.flatMap((bp) =>
		bp.materials.map((m) => ({ blueprintTypeId: bp.blueprintTypeId, typeId: m.typeId, quantity: m.quantity }))
	);
	const statements: BatchItem<'sqlite'>[] = [
		db.delete(reactionMaterials),
		db.delete(reprocessMaterials),
		db.delete(materialBlueprintMaterials),
		db.delete(manufacturingBlueprintMaterials),
		db.delete(manufacturingBlueprints),
		db.delete(reactions),
		...chunkRows(reactionRows, 11).map((chunk) => db.insert(reactions).values(chunk)),
		...chunkRows(materialRows, 3).map((chunk) => db.insert(reactionMaterials).values(chunk)),
		...chunkRows(reprocessRows, 6).map((chunk) => db.insert(reprocessMaterials).values(chunk)),
		...chunkRows(blueprintMaterialRows, 3).map((chunk) =>
			db.insert(materialBlueprintMaterials).values(chunk)
		),
		...chunkRows(consumingRows, 5).map((chunk) => db.insert(manufacturingBlueprints).values(chunk)),
		...chunkRows(consumingMaterialRows, 3).map((chunk) =>
			db.insert(manufacturingBlueprintMaterials).values(chunk)
		)
	];
	await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
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
