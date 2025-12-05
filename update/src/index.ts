import type {
	D1Database,
	D1PreparedStatement,
	ExecutionContext,
	KVNamespace,
	ScheduledController
} from '@cloudflare/workers-types';

export interface Env {
	DB: D1Database;
	ENDPOINTS: KVNamespace;
	DATA: KVNamespace;
}

const userAgent = "EVE-Reactions-Calculator-Updater/1.2.0 (production; +https://reactions.coalition.space/) (+https://github.com/zmiguel/Eve-Reactions-Calculator; mail:eve@zmiguel.me; eve:Oxed G; discord:oxedpixel)";

// SDE LINKS
const SDE_FILE = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';
const SDE_VERSION = 'https://developers.eveonline.com/static-data/tranquility/latest.jsonl';

async function getRequiredKVText(kv: KVNamespace, key: string): Promise<string> {
	const value = await kv.get(key, 'text');
	if (!value) {
		throw new Error(`Missing KV value for key: ${key}`);
	}
	return value;
}

async function getRequiredKVJSON<T>(kv: KVNamespace, key: string): Promise<T> {
	const text = await getRequiredKVText(kv, key);
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		throw new Error(`Failed to parse JSON for ${key}: ${(error as Error).message}`);
	}
}

async function fetchJSON<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'Accept-Language': 'en',
			'X-Compatibility-Date': '2025-10-29',
			'X-Tenant': 'tranquility',
			'User-Agent': userAgent,
			'X-User-Agent': userAgent
		}
	});
	if (!response.ok) {
		throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
	}
	return (await response.json()) as T;
}

type ItemRecord = { id: number; adjusted_price?: number | null };
type EsiPriceRecord = { type_id: number; adjusted_price?: number | null };
type BlueprintInput = { id: number; qt: number };
type BlueprintRecord = { _id: number; type: string; inputs?: BlueprintInput[] };
type CostIndexActivity = { activity?: string; cost_index?: number | null };
type CostIndexRecord = { solar_system_id: number; cost_indices?: CostIndexActivity[] };
type SystemsConfig = { systems: string[] };
type MarketPriceEntry = { sell?: { min?: number | null }; buy?: { max?: number | null } };
type MarketPriceResponse = Record<string, MarketPriceEntry>;
type PriceRow = { item_id: number };
type SystemRow = { id: number };

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function calculateBlueprintCost(
	blueprint: BlueprintRecord,
	priceMap: Map<number, number | null | undefined>
): number {
	let total = 0;
	for (const input of blueprint.inputs ?? []) {
		const adjustedPrice = priceMap.get(input.id);
		if (isFiniteNumber(adjustedPrice)) {
			total += adjustedPrice * input.qt;
		}
	}
	return total;
}

function hasNonZeroPrices(data: MarketPriceResponse, itemIds: number[]): boolean {
	return itemIds.some((id) => {
		const entry = data[String(id)];
		if (!entry) {
			return false;
		}
		const sellMin = entry.sell?.min ?? 0;
		const buyMax = entry.buy?.max ?? 0;
		return sellMin > 0 || buyMax > 0;
	});
}

async function fetchMarketPricesWithRetry(
	marketUrl: string,
	itemIdsParam: string,
	systemName: string,
	systemId: number,
	itemIds: number[]
): Promise<MarketPriceResponse | null> {
	const url = `${marketUrl}?types=${itemIdsParam}&region=${systemId}`;
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			const data = await fetchJSON<MarketPriceResponse>(url);
			if (!data || Object.keys(data).length === 0 || !hasNonZeroPrices(data, itemIds)) {
				if (attempt === 1) {
					console.warn(
						`Market data empty for system ${systemName} (ID ${systemId}) on attempt ${attempt}; retrying once.`
					);
					continue;
				}
				console.error(
					`Market data empty for system ${systemName} (ID ${systemId}) after retry; skipping.`
				);
				return null;
			}
			return data;
		} catch (error) {
			if (attempt === 1) {
				console.warn(
					`Market data fetch failed for system ${systemName} (ID ${systemId}) on attempt ${attempt}; retrying once.`,
					error
				);
				continue;
			}
			console.error(
				`Market data fetch failed for system ${systemName} (ID ${systemId}) after retry; skipping.`,
				error
			);
			return null;
		}
	}
	return null;
}

async function runStep(name: string, step: () => Promise<void>) {
	console.info(`Running ${name}`);
	try {
		await step();
	} catch (error) {
		console.error(`${name} failed:`, error);
	}
}

async function update_adjusted_item_prices_cron(env: Env) {
	const itemsQuery = await getRequiredKVText(env.DATA, 'query-items');
	const itemsResult = await env.DB.prepare(itemsQuery).all<ItemRecord>();
	const items = itemsResult.results ?? [];
	if (!items.length) {
		console.info('No items found for adjusted price update.');
		return;
	}

	const esiUrl =
		(await getRequiredKVText(env.ENDPOINTS, 'ESI_BASE')) +
		(await getRequiredKVText(env.ENDPOINTS, 'ESI_MARKET_PRICES')) +
		(await getRequiredKVText(env.ENDPOINTS, 'ESI_DATA_SOURCE'));
	const esiPrices = await fetchJSON<EsiPriceRecord[]>(esiUrl);
	const updateQuery = await getRequiredKVText(env.DATA, 'query-update-items-adjusted-price');
	const updateStatement = env.DB.prepare(updateQuery);

	const batch: D1PreparedStatement[] = [];
	for (const item of items) {
		const adjustedPrice = esiPrices.find((price) => price.type_id === item.id)?.adjusted_price;
		if (isFiniteNumber(adjustedPrice)) {
			batch.push(updateStatement.bind(adjustedPrice, item.id));
		}
	}

	if (batch.length === 0) {
		console.info('No adjusted item prices required updating.');
		return;
	}

	console.log(`items to update adjusted cost: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

async function update_base_industry_cost_cron(env: Env) {
	const itemsQuery = await getRequiredKVText(env.DATA, 'query-items');
	const itemsResult = await env.DB.prepare(itemsQuery).all<ItemRecord>();
	const items = itemsResult.results ?? [];
	if (!items.length) {
		console.info('No items found for industry cost update.');
		return;
	}

	const priceMap = new Map(items.map((item) => [item.id, item.adjusted_price]));
	const [bpComp, bpBio, bpHybrid] = await Promise.all([
		getRequiredKVJSON<BlueprintRecord[]>(env.DATA, 'bp-comp'),
		getRequiredKVJSON<BlueprintRecord[]>(env.DATA, 'bp-bio'),
		getRequiredKVJSON<BlueprintRecord[]>(env.DATA, 'bp-hybrid')
	]);
	const updateQuery = await getRequiredKVText(env.DATA, 'query-update-indy-cost');
	const updateStatement = env.DB.prepare(updateQuery);
	const batch: D1PreparedStatement[] = [];

	const queueBlueprints = (blueprints: BlueprintRecord[], skipType?: string) => {
		for (const blueprint of blueprints ?? []) {
			if (skipType && blueprint.type === skipType) {
				continue;
			}
			const totalCost = calculateBlueprintCost(blueprint, priceMap);
			batch.push(updateStatement.bind(totalCost, blueprint._id));
		}
	};

	queueBlueprints(bpComp, 'refined');
	queueBlueprints(bpBio);
	queueBlueprints(bpHybrid);

	if (batch.length === 0) {
		console.info('No base industry costs required updating.');
		return;
	}

	console.log(`items to update industry cost: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

async function update_cost_index_cron(env: Env) {
	const systemsQuery = await getRequiredKVText(env.DATA, 'query-systems');
	const systemsResult = await env.DB.prepare(systemsQuery).all<SystemRow>();
	const systems = systemsResult.results ?? [];
	if (!systems.length) {
		console.info('No systems found for cost index update.');
		return;
	}

	const esiUrl =
		(await getRequiredKVText(env.ENDPOINTS, 'ESI_BASE')) +
		(await getRequiredKVText(env.ENDPOINTS, 'ESI_COST_INDEX')) +
		(await getRequiredKVText(env.ENDPOINTS, 'ESI_DATA_SOURCE'));
	const esiCostIndex = await fetchJSON<CostIndexRecord[]>(esiUrl);
	const updateQuery = await getRequiredKVText(env.DATA, 'query-update-cost-index');
	const updateStatement = env.DB.prepare(updateQuery);
	const batch: D1PreparedStatement[] = [];

	for (const system of systems) {
		const entry = esiCostIndex.find((item) => item.solar_system_id === system.id);
		const reactionIndex = entry?.cost_indices?.find((ci) => ci.activity === 'reaction');
		const fallbackIndex = entry?.cost_indices?.[5];
		const costIndexValue = reactionIndex?.cost_index ?? fallbackIndex?.cost_index;
		if (isFiniteNumber(costIndexValue)) {
			batch.push(updateStatement.bind(costIndexValue, system.id));
		}
	}

	if (batch.length === 0) {
		console.info('No cost index updates required.');
		return;
	}

	console.log(`items to update cost index: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

async function update_item_prices_cron(env: Env) {
	const systemsConfig = await getRequiredKVJSON<SystemsConfig>(env.DATA, 'systems-for-price-tracking');
	const systems = Array.isArray(systemsConfig.systems) ? systemsConfig.systems : [];
	if (!systems.length) {
		console.warn('No systems configured for price tracking.');
		return;
	}

	const itemsQuery = await getRequiredKVText(env.DATA, 'query-items');
	const itemsResult = await env.DB.prepare(itemsQuery).all<ItemRecord>();
	const items = itemsResult.results ?? [];
	if (!items.length) {
		console.warn('No items found for price update.');
		return;
	}

	const itemIds = items.map((item) => item.id);
	const itemIdsParam = itemIds.join(',');

	const updateQuery = await getRequiredKVText(env.DATA, 'query-update-price');
	const createQuery = await getRequiredKVText(env.DATA, 'query-create-price');
	const updateStatement = env.DB.prepare(updateQuery);
	const createStatement = env.DB.prepare(createQuery);

	const pricesForSystemQuery = await getRequiredKVText(env.DATA, 'query-prices-for-system');
	const systemIdQuery = await getRequiredKVText(env.DATA, 'query-system-id');
	const marketUrlBase = await getRequiredKVText(env.ENDPOINTS, 'FUZZWORKS_MARKET_API');

	const batch: D1PreparedStatement[] = [];

	for (const system of systems) {
		try {
			const currentPricesResult = await env.DB
				.prepare(pricesForSystemQuery)
				.bind(system)
				.all<PriceRow>();
			const currentPrices = currentPricesResult.results ?? [];
			const currentPriceMap = new Map(currentPrices.map((row) => [row.item_id, true]));

			const systemId = await env.DB
				.prepare(systemIdQuery)
				.bind(system)
				.first<number>('id');
			if (!isFiniteNumber(systemId)) {
				console.warn(`Skipping system ${String(system)}: missing numeric ID.`);
				continue;
			}

			const marketPrices = await fetchMarketPricesWithRetry(
				marketUrlBase,
				itemIdsParam,
				String(system),
				systemId,
				itemIds
			);
			if (!marketPrices) {
				continue;
			}

			for (const item of items) {
				const entry = marketPrices[String(item.id)];
				const sellMin = entry?.sell?.min ?? 0;
				const buyMax = entry?.buy?.max ?? 0;

				if (currentPriceMap.has(item.id)) {
					batch.push(updateStatement.bind(sellMin, buyMax, item.id, system));
				} else {
					batch.push(createStatement.bind(item.id, system, sellMin, buyMax));
				}
			}
		} catch (error) {
			console.error(`Failed to update prices for system ${String(system)}:`, error);
		}
	}

	if (batch.length === 0) {
		console.info('No price updates queued.');
		return;
	}

	console.log(`items to update prices: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

async function update_static_data_cron(env: Env) {
	try {
		console.info('Checking for SDE updates...');

		let currentSDEVersion: { release_version: number; release_date: string } | null = null;

		// Get latest SDE version from database
		const lastSDEQuery = await getRequiredKVText(env.DATA, 'query-last-sde-version');
		const lastSDEResult = await env.DB.prepare(lastSDEQuery).first<{
			release_version: number;
			release_date: string;
		}>();

		// Get online SDE version
		const versionResponse = await fetch(SDE_VERSION, {
			headers: { 'User-Agent': userAgent }
		});
		if (!versionResponse.ok) {
			throw new Error(`Failed to fetch SDE version: ${versionResponse.status}`);
		}

		const versionText = await versionResponse.text();
		let sdeData: { buildNumber: number; releaseDate: string };

		try {
			sdeData = JSON.parse(versionText);
		} catch {
			const lines = versionText.trim().split('\n');
			if (lines.length > 0) {
				sdeData = JSON.parse(lines[0]);
			} else {
				throw new Error('Failed to parse SDE version data');
			}
		}

		const onlineVersion = {
			release_version: sdeData.buildNumber,
			release_date: sdeData.releaseDate
		};
		currentSDEVersion = onlineVersion;

		console.log(`Online SDE version: ${onlineVersion.release_version} (${onlineVersion.release_date})`);

		// Check if update is needed
		if (lastSDEResult && lastSDEResult.release_version === onlineVersion.release_version) {
			console.info('SDE is up to date, no update needed.');
			return;
		}

		console.info('SDE update needed. Downloading and processing...');

		// Download the ZIP file
		const sdeResponse = await fetch(SDE_FILE, {
			headers: { 'User-Agent': userAgent }
		});
		if (!sdeResponse.ok) {
			throw new Error(`Failed to download SDE: ${sdeResponse.status}`);
		}

		const sdeBlob = await sdeResponse.arrayBuffer();
		console.log(`Downloaded SDE file: ${sdeBlob.byteLength} bytes`);

		// Extract and process the files we need
		const filesToExtract = ['categories.jsonl', 'groups.jsonl'];
		const extractedFiles = await extractJSONLFromZip(sdeBlob, filesToExtract);

		// Process categories
		console.info('Processing categories...');
		const categoriesData: { id: number; name: string }[] = [];
		if (extractedFiles['categories.jsonl']) {
			const lines = extractedFiles['categories.jsonl'].split('\n');
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const data = JSON.parse(line) as { _key: number; name?: { en?: string } };
					if (data._key && data.name?.en) {
						categoriesData.push({ id: data._key, name: data.name.en });
					}
				} catch (e) {
					console.warn('Failed to parse category line:', e);
				}
			}
		}
		console.log(`Parsed ${categoriesData.length} categories`);

		// Process groups
		console.info('Processing groups...');
		const groupsData: { id: number; category: number; name: string }[] = [];
		if (extractedFiles['groups.jsonl']) {
			const lines = extractedFiles['groups.jsonl'].split('\n');
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const data = JSON.parse(line) as {
						_key: number;
						name?: { en?: string };
						categoryID?: number;
					};
					if (data._key && data.name?.en && data.categoryID) {
						groupsData.push({
							id: data._key,
							category: data.categoryID,
							name: data.name.en
						});
					}
				} catch (e) {
					console.warn('Failed to parse group line:', e);
				}
			}
		}
		console.log(`Parsed ${groupsData.length} groups`);

		// Prepare queries
		const updateCategoryQuery = await getRequiredKVText(env.DATA, 'query-update-category');
		const updateCategoryStmt = env.DB.prepare(updateCategoryQuery);
		const updateGroupQuery = await getRequiredKVText(env.DATA, 'query-update-group');
		const updateGroupStmt = env.DB.prepare(updateGroupQuery);
		const updateItemQuery = await getRequiredKVText(env.DATA, 'query-update-item');
		const updateItemStmt = env.DB.prepare(updateItemQuery);

		// Update categories
		if (categoriesData.length) {
			console.info(`Updating ${categoriesData.length} categories...`);
			const categoryBatch: D1PreparedStatement[] = categoriesData.map((cat) =>
				updateCategoryStmt.bind(cat.id, cat.name)
			);
			const info = await env.DB.batch(categoryBatch);
			console.log(`Categories updated: ${info.length}`);
		} else {
			console.info('No categories to update.');
		}

		// Update groups
		if (groupsData.length) {
			console.info(`Updating ${groupsData.length} groups...`);
			const groupBatch: D1PreparedStatement[] = groupsData.map((grp) =>
				updateGroupStmt.bind(grp.id, grp.name, grp.category)
			);
			const info = await env.DB.batch(groupBatch);
			console.log(`Groups updated: ${info.length}`);
		} else {
			console.info('No groups to update.');
		}

		// Process and update items in streaming fashion to stay within memory limits
		console.info('Processing types/items...');
		let itemsProcessed = 0;
		const itemBatch: D1PreparedStatement[] = [];
		const ITEM_BATCH_SIZE = 500;

		const flushItemBatch = async () => {
			if (!itemBatch.length) {
				return;
			}
			const statements = itemBatch.splice(0, itemBatch.length);
			const info = await env.DB.batch(statements);
			console.log(`Flushed ${info.length} item statements to database.`);
		};

		const foundTypesFile = await processJSONLFileFromZip(
			sdeBlob,
			'types.jsonl',
			async (line) => {
				if (!line.trim()) {
					return;
				}
				try {
					const data = JSON.parse(line) as {
						_key: number;
						name?: { en?: string };
						groupID?: number;
					};
					if (data._key && data.name?.en && data.groupID) {
						itemBatch.push(updateItemStmt.bind(data._key, data.name.en, data.groupID));
						itemsProcessed++;
						if (itemBatch.length >= ITEM_BATCH_SIZE) {
							await flushItemBatch();
						}
					}
				} catch (lineError) {
					console.warn('Failed to parse type line:', lineError);
				}
			}
		);

		if (!foundTypesFile) {
			console.warn('types.jsonl not found in archive; skipping item updates.');
		} else {
			await flushItemBatch();
			console.log(`Processed ${itemsProcessed} items.`);
		}

		// Record SDE update in database
		const insertSDEQuery = await getRequiredKVText(env.DATA, 'query-insert-sde');
		await env.DB.prepare(insertSDEQuery).bind(
			onlineVersion.release_date,
			onlineVersion.release_version,
			new Date().toISOString(),
			true
		).run();

		console.info(`SDE update completed successfully. Version: ${onlineVersion.release_version}`);
	} catch (error) {
		console.error('Static data update failed:', error);
		// Record failed update
		try {
			const insertSDEQuery = await getRequiredKVText(env.DATA, 'query-insert-sde');
			const nowIso = new Date().toISOString();
			await env.DB.prepare(insertSDEQuery).bind(
				currentSDEVersion?.release_date ?? nowIso,
				currentSDEVersion?.release_version ?? 0,
				nowIso,
				false
			).run();
		} catch (recordError) {
			console.error('Failed to record SDE update failure:', recordError);
		}
	}
}

async function extractJSONLFromZip(
	zipBuffer: ArrayBuffer,
	filesToExtract: string[]
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	const view = new DataView(zipBuffer);

	// Simple ZIP parser - looks for local file headers
	let offset = 0;
	const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

	while (offset < view.byteLength - 30) {
		const signature = view.getUint32(offset, true);
		if (signature !== ZIP_LOCAL_FILE_HEADER) {
			offset++;
			continue;
		}

		const fileNameLength = view.getUint16(offset + 26, true);
		const extraFieldLength = view.getUint16(offset + 28, true);
		const compressedSize = view.getUint32(offset + 18, true);
		const compressionMethod = view.getUint16(offset + 8, true);

		const fileNameOffset = offset + 30;
		const fileNameBytes = new Uint8Array(zipBuffer, fileNameOffset, fileNameLength);
		const fileName = new TextDecoder('utf-8').decode(fileNameBytes);

		const dataOffset = fileNameOffset + fileNameLength + extraFieldLength;

		// Check if this is a file we want
		if (filesToExtract.some((f) => fileName.endsWith(f))) {
			console.log(`Extracting ${fileName} (${compressedSize} bytes, method: ${compressionMethod})`);

			if (compressionMethod === 0) {
				// Stored (not compressed)
				const fileData = new Uint8Array(zipBuffer, dataOffset, compressedSize);
				result[fileName] = new TextDecoder('utf-8').decode(fileData);
			} else if (compressionMethod === 8) {
				// Deflate compression - use DecompressionStream with streaming decoder
				const compressedData = new Uint8Array(zipBuffer, dataOffset, compressedSize);
				try {
					const stream = new ReadableStream({
						start(controller) {
							controller.enqueue(compressedData);
							controller.close();
						}
					});
					const decompressedStream = stream.pipeThrough(
						new DecompressionStream('deflate-raw')
					);
					const reader = decompressedStream.getReader();

					// Decode in chunks to avoid memory issues with large files
					let resultText = '';
					const streamingDecoder = new TextDecoder('utf-8', { stream: true });

					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							// Final decode with stream: false
							resultText += new TextDecoder('utf-8').decode();
							break;
						}
						// Stream decode each chunk
						resultText += streamingDecoder.decode(value, { stream: true });
					}

					result[fileName] = resultText;
					console.log(`Successfully extracted ${fileName} (${resultText.length} chars)`);
				} catch (e) {
					console.error(`Failed to decompress ${fileName}:`, e);
				}
			} else {
				console.warn(`Unsupported compression method ${compressionMethod} for ${fileName}`);
			}
		}

		offset = dataOffset + compressedSize;
	}

	return result;
}

async function processJSONLFileFromZip(
	zipBuffer: ArrayBuffer,
	targetFile: string,
	onLine: (line: string) => Promise<void> | void
): Promise<boolean> {
	const view = new DataView(zipBuffer);
	let offset = 0;
	const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

	while (offset < view.byteLength - 30) {
		const signature = view.getUint32(offset, true);
		if (signature !== ZIP_LOCAL_FILE_HEADER) {
			offset++;
			continue;
		}

		const fileNameLength = view.getUint16(offset + 26, true);
		const extraFieldLength = view.getUint16(offset + 28, true);
		const compressedSize = view.getUint32(offset + 18, true);
		const compressionMethod = view.getUint16(offset + 8, true);

		const fileNameOffset = offset + 30;
		const fileNameBytes = new Uint8Array(zipBuffer, fileNameOffset, fileNameLength);
		const fileName = new TextDecoder('utf-8').decode(fileNameBytes);
		const dataOffset = fileNameOffset + fileNameLength + extraFieldLength;

		if (!fileName.endsWith(targetFile)) {
			offset = dataOffset + compressedSize;
			continue;
		}

		console.log(`Streaming ${fileName} (${compressedSize} bytes, method: ${compressionMethod})`);

		if (compressionMethod === 0) {
			const fileData = new Uint8Array(zipBuffer, dataOffset, compressedSize);
			const text = new TextDecoder('utf-8').decode(fileData);
			for (const line of text.split('\n')) {
				if (line.trim()) {
					await onLine(line);
				}
			}
			return true;
		}

		if (compressionMethod === 8) {
			const compressedData = new Uint8Array(zipBuffer, dataOffset, compressedSize);
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(compressedData);
					controller.close();
				}
			});
			const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
			const reader = decompressedStream.getReader();
			const decoder = new TextDecoder('utf-8');
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					buffer += decoder.decode();
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				buffer = await flushBufferedLines(buffer, onLine, false);
			}

			await flushBufferedLines(buffer, onLine, true);
			return true;
		}

		console.warn(`Unsupported compression method ${compressionMethod} for ${fileName}`);
		return false;
	}

	return false;
}

async function flushBufferedLines(
	buffer: string,
	onLine: (line: string) => Promise<void> | void,
	flushRemaining: boolean
): Promise<string> {
	let workingBuffer = buffer;
	let newlineIndex = workingBuffer.indexOf('\n');
	while (newlineIndex !== -1) {
		const line = workingBuffer.slice(0, newlineIndex);
		workingBuffer = workingBuffer.slice(newlineIndex + 1);
		if (line.trim()) {
			await onLine(line);
		}
		newlineIndex = workingBuffer.indexOf('\n');
	}

	if (flushRemaining && workingBuffer.trim()) {
		await onLine(workingBuffer);
		return '';
	}

	return workingBuffer;
}

export default {
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
		const now = new Date(event.scheduledTime ?? Date.now());
		console.info(`Cron triggered at ${now.toISOString()}`);
		console.info(`Using user agent: ${userAgent}`);

		// Run SDE update only once per day at 12:00 UTC
		const currentHour = now.getUTCHours();
		const currentMinute = now.getUTCMinutes();
		if (currentHour === 12 && currentMinute === 0) {
			await runStep('Update Static Data Cron', () => update_static_data_cron(env));
		}

		await runStep('Update Adjusted Item Prices Cron', () => update_adjusted_item_prices_cron(env));
		await runStep('Update Base Industry Cost Cron', () => update_base_industry_cost_cron(env));
		await runStep('Update Cost Index Cron', () => update_cost_index_cron(env));
		await runStep('Update Item Prices Cron', () => update_item_prices_cron(env));
		console.info('Cron execution finished.');
		void ctx; // keep worker runtime happy when not using the execution context
	}
};
