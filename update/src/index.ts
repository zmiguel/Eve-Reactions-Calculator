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
	const userAgent = "EVE-Reactions-Calculator-Updater/1.1.0 (production; +https://reactions.coalition.space/) (+https://github.com/zmiguel/Eve-Reactions-Calculator; mail:eve@zmiguel.me; eve:Oxed G; discord:oxedpixel)";
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

export default {
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
		console.info(
			`Cron triggered at ${new Date(event.scheduledTime ?? Date.now()).toISOString()}`
		);
		const userAgent = buildUserAgent();
		console.info(`Using user agent: ${userAgent}`);
		await runStep('Update Adjusted Item Prices Cron', () => update_adjusted_item_prices_cron(env));
		await runStep('Update Base Industry Cost Cron', () => update_base_industry_cost_cron(env));
		await runStep('Update Cost Index Cron', () => update_cost_index_cron(env));
		await runStep('Update Item Prices Cron', () => update_item_prices_cron(env));
		console.info('Cron execution finished.');
		void ctx; // keep worker runtime happy when not using the execution context
	}
};
