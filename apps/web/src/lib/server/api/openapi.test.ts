import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { SITE_URL } from '$lib/site';
import { openapi } from './openapi';
import {
	COST_INDEX_COLUMNS,
	CostIndicesResponse,
	HISTORY_COLUMNS,
	HubsResponse,
	MetaResponse,
	PlanBody,
	PlanResultResponse,
	PRICE_COLUMNS,
	PriceHistoryResponse,
	PricesResponse,
	PROFIT_COLUMNS,
	ProfitsResponse,
	ReactionResponse,
	ReactionResultResponse,
	ReactionsResponse,
	SystemResponse,
	SystemsResponse
} from './schemas';
import { SETTINGS_PARAMS } from './settings';

const doc = JSON.parse(JSON.stringify(openapi));

function refs(value: unknown, out: string[] = []): string[] {
	if (Array.isArray(value)) value.forEach((v) => refs(v, out));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			if (k === '$ref' && typeof v === 'string') out.push(v);
			else refs(v, out);
		}
	}
	return out;
}

type Param = {
	name: string;
	in: string;
	required: boolean;
	schema: Record<string, unknown>;
	example?: unknown;
	examples?: Record<string, { value: unknown; 'x-disabled'?: boolean }>;
};
type Media = { example?: unknown; examples?: Record<string, { value: unknown }> };
type Op = {
	operationId: string;
	summary: string;
	description: string;
	tags: string[];
	parameters?: Param[];
	requestBody?: { content: Record<string, Media> };
	responses: Record<
		string,
		{ headers?: Record<string, { schema: { const: string } }>; content?: Record<string, Media> }
	>;
};
const operations = Object.entries(doc.paths as Record<string, Record<string, Op>>).flatMap(([path, item]) =>
	Object.entries(item).map(([method, op]) => ({ path, method, op }))
);
const op = (path: string) => Object.values(doc.paths[path] as Record<string, Op>)[0];

/** 200 response schema of each operation (the contract tests parse real responses with the same ones). */
const RESPONSE: Record<string, z.ZodType> = {
	getMeta: MetaResponse,
	listHubs: HubsResponse,
	searchSystems: SystemsResponse,
	getSystem: SystemResponse,
	listReactions: ReactionsResponse,
	getReaction: ReactionResponse,
	getPrices: PricesResponse,
	getPriceHistory: PriceHistoryResponse,
	getCostIndices: CostIndicesResponse,
	listProfits: ProfitsResponse,
	getProfit: ReactionResultResponse,
	plan: PlanResultResponse
};
const CSV_HEADER: Record<string, readonly string[]> = {
	getPrices: PRICE_COLUMNS,
	getPriceHistory: HISTORY_COLUMNS,
	getCostIndices: COST_INDEX_COLUMNS,
	listProfits: PROFIT_COLUMNS
};

describe('OpenAPI document', () => {
	it('is an OpenAPI 3.1 document whose every $ref resolves', () => {
		expect(doc.openapi).toBe('3.1.0');
		for (const ref of refs(doc)) {
			const target = ref
				.replace(/^#\//, '')
				.split('/')
				.reduce((node: Record<string, unknown> | undefined, key) => node?.[key] as never, doc);
			expect(target, ref).toBeDefined();
		}
		expect(Object.keys(doc.components.schemas)).toEqual(
			expect.arrayContaining([
				'Error',
				'Meta',
				'Hub',
				'System',
				'Reaction',
				'Prices',
				'PriceHistory',
				'CostIndex'
			])
		);
		expect(Object.keys(doc.components.schemas)).toEqual(
			expect.arrayContaining([
				'Profits',
				'ProfitRow',
				'ReactionResult',
				'ChainNode',
				'PlanResult',
				'PlanRequest'
			])
		);
	});

	it('has unique operation ids, a summary, a described tag, Cache-Control and error responses per operation', () => {
		const ids = operations.map((o) => o.op.operationId);
		expect(new Set(ids).size).toBe(ids.length);
		const tags = new Map(
			(doc.tags as { name: string; description: string }[]).map((t) => [t.name, t.description])
		);
		for (const { path, op } of operations) {
			expect(op.summary, path).toBeTruthy();
			expect(op.description, path).toBeTruthy();
			expect(tags.get(op.tags[0]), path).toBeTruthy();
			expect(op.responses['200'].headers?.['Cache-Control'].schema.const).toMatch(/max-age|no-store/);
			expect(op.responses['429']).toEqual({ $ref: '#/components/responses/RateLimited' });
		}
	});

	it('names the production server', () => {
		expect(doc.servers).toEqual([{ url: SITE_URL, description: 'Production' }]);
		expect(SITE_URL).toBe('https://reactions.coalition.space');
	});

	it('gives every 200 response a JSON example that parses with its response schema', () => {
		for (const { path, op } of operations) {
			const json = op.responses['200'].content!['application/json'];
			if (op.operationId === 'getOpenApi') continue;
			expect(json.example, path).toBeDefined();
			expect(RESPONSE[op.operationId].safeParse(json.example).error, path).toBeUndefined();
		}
	});

	it('offers text/csv with a CSV example exactly where format=csv is accepted', () => {
		for (const { path, op } of operations) {
			const csv = op.responses['200'].content!['text/csv'];
			const acceptsCsv = op.parameters?.some((p) => p.name === 'format') ?? false;
			expect(csv !== undefined, path).toBe(acceptsCsv);
			if (!csv) continue;
			const [header, ...rows] = (csv.example as string).trimEnd().split('\n');
			expect(header.split(','), path).toEqual([...CSV_HEADER[op.operationId]]);
			expect(rows.length, path).toBeGreaterThan(0);
		}
		expect(Object.keys(CSV_HEADER).sort()).toEqual(
			operations
				.filter((o) => o.op.responses['200'].content!['text/csv'])
				.map((o) => o.op.operationId)
				.sort()
		);
	});

	it('has POST /plan request examples that are valid plan bodies', () => {
		const media = op('/api/v2/plan').requestBody!.content['application/json'];
		const examples = Object.values(media.examples!);
		expect(examples.length).toBeGreaterThanOrEqual(2);
		for (const { value } of examples) expect(PlanBody.safeParse(value).error).toBeUndefined();
		expect(examples[0].value).toEqual({ totalSlots: 30, targets: [{ slug: 'titanium-carbide', lines: 2 }] });
	});

	it('sends only required and chosen parameter examples; other optional ones are shown disabled', () => {
		const sent = (path: string) =>
			Object.fromEntries(
				op(path)
					.parameters!.filter((p) => p.example !== undefined)
					.map((p) => [p.name, p.example])
			);
		expect(sent('/api/v2/profits')).toEqual({ reactor: 'composite', tier: 'composite' });
		expect(sent('/api/v2/prices')).toEqual({ hub: 'jita', types: '16663,16671' });
		expect(sent('/api/v2/systems')).toEqual({ q: 'ign' });
		expect(sent('/api/v2/profits/{slug}')).toEqual({ slug: 'titanium-carbide' });
		for (const { path, op } of operations) {
			for (const p of op.parameters ?? []) {
				if (p.example !== undefined) continue;
				expect(p.required, `${path} ${p.name}`).toBe(false);
				if (p.examples) expect(p.examples.default['x-disabled'], `${path} ${p.name}`).toBe(true);
			}
		}
		const profits = op('/api/v2/profits').parameters!;
		expect(profits.find((p) => p.name === 'broker')!.examples).toEqual({
			default: { value: 1.5, 'x-disabled': true }
		});
		expect(profits.find((p) => p.name === 'system')!.examples).toEqual({
			default: { value: 'Ignoitton', 'x-disabled': true }
		});
	});

	it('documents every plan parameter of the profit endpoints with types and defaults', () => {
		const params = (path: string) =>
			Object.fromEntries((doc.paths[path].get as Op).parameters!.map((p) => [p.name, p.schema]));
		const profits = params('/api/v2/profits');
		for (const name of [
			...Object.keys(SETTINGS_PARAMS),
			'reactor',
			'tier',
			'view',
			'slots',
			'lines',
			'date',
			'format'
		])
			expect(profits[name], name).toBeDefined();
		expect(profits.broker).toEqual({ type: 'number', minimum: 0, maximum: 10, default: 1.5 });
		expect(profits.skill).toEqual({ type: 'integer', minimum: 1, maximum: 5, default: 5 });
		expect(profits.view).toEqual({
			type: 'string',
			enum: ['single', 'chain', 'unrefined', 'best'],
			default: 'best'
		});
		expect(profits.unrefinedInChains).toEqual({ type: 'string', enum: ['never', 'best'], default: 'never' });
		expect(params('/api/v2/profits/{slug}').view).toMatchObject({ enum: ['single', 'chain', 'unrefined'] });
		expect(profits.lines).toEqual({ type: 'integer', minimum: 1, maximum: 10 });
		expect(params('/api/v2/profits/{slug}').slug).toEqual({ type: 'string' });
		expect(params('/api/v2/prices').types).toMatchObject({ type: 'string', pattern: '^\\d+(,\\d+)*$' });
	});

	it('describes the plan request body and its limits', () => {
		const body = doc.components.schemas.PlanRequest;
		expect(body.required).toEqual(['totalSlots', 'targets']);
		expect(body.properties.totalSlots).toMatchObject({ minimum: 1, maximum: 10000 });
		expect(body.properties.targets).toMatchObject({ minItems: 1, maxItems: 50 });
	});
});
