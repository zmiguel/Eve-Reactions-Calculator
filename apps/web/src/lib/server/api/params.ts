import { z } from 'zod';

/**
 * API v2 query parameters described once: each helper returns the zod validator and the OpenAPI
 * parameter documentation (type, range, enum, default), so validation and docs cannot drift apart.
 */

export interface ParamDoc {
	description: string;
	/** JSON Schema of the parameter value (OpenAPI 3.1 `schema`). */
	schema: Record<string, unknown>;
	required?: boolean;
	example?: string;
}

export interface QueryParam<S extends z.ZodType = z.ZodType> {
	doc: ParamDoc;
	zod: S;
}

/** OpenAPI `in: query` parameter object. */
export interface OpenApiParameter extends ParamDoc {
	name: string;
	in: 'query' | 'path';
	required: boolean;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const ID_LIST = /^\d+(,\d+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Trimmed query text; a missing value reports `Required`. */
const text = () =>
	z.string({ error: (issue) => (issue.input === undefined ? 'Required' : 'Must be text') }).trim();

/** Decimal number in `[min, max]`; `default` is documentation only (the caller's default applies). */
export function numberParam(
	description: string,
	o: { min: number; max: number; integer?: boolean; default?: number | null; example?: string }
) {
	const value = z.number().min(o.min, `Must be at least ${o.min}`).max(o.max, `Must be at most ${o.max}`);
	return {
		doc: {
			description,
			schema: {
				type: o.integer ? 'integer' : 'number',
				minimum: o.min,
				maximum: o.max,
				...(o.default === undefined ? {} : { default: o.default })
			},
			...(o.example ? { example: o.example } : {})
		},
		zod: text()
			.regex(NUMBER, 'Must be a number')
			.transform(Number)
			.pipe(o.integer ? value.int('Must be a whole number') : value)
			.optional()
	};
}

/** One of `values`; absent → `undefined` (`docDefault` only documents the effective default). */
export function enumParam<const V extends readonly [string, ...string[]]>(
	description: string,
	values: V,
	docDefault?: V[number]
) {
	return {
		doc: {
			description,
			schema: {
				type: 'string',
				enum: [...values],
				...(docDefault === undefined ? {} : { default: docDefault })
			}
		},
		zod: z.enum(values, { error: `Must be one of: ${values.join(', ')}` }).optional()
	};
}

/** One of `values`, `fallback` when absent. */
export function enumDefaultParam<const V extends readonly [string, ...string[]]>(
	description: string,
	values: V,
	fallback: V[number]
) {
	return {
		doc: { description, schema: { type: 'string', enum: [...values], default: fallback } },
		zod: z.enum(values, { error: `Must be one of: ${values.join(', ')}` }).default(fallback as never)
	};
}

/** Free text (trimmed, non-empty). */
export function stringParam(description: string, o: { default?: string; example?: string } = {}) {
	return {
		doc: {
			description,
			schema: { type: 'string', minLength: 1, ...(o.default === undefined ? {} : { default: o.default }) },
			...(o.example ? { example: o.example } : {})
		},
		zod: text().min(1, 'Must not be empty').optional()
	};
}

/** `YYYY-MM-DD` and a real calendar day. */
export function isIsoDate(value: string): boolean {
	if (!DATE.test(value)) return false;
	const ms = Date.parse(`${value}T00:00:00Z`);
	return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** A valid calendar date `YYYY-MM-DD` (range checks need the clock and happen in the handler). */
export function dateParam(description: string, example = '2026-10-01') {
	return {
		doc: { description, schema: { type: 'string', format: 'date' }, example },
		zod: text().refine(isIsoDate, { error: 'Must be a date YYYY-MM-DD' }).optional()
	};
}

/** Comma-separated positive integer ids (duplicates removed), at most `max`. */
export function idListParam(description: string, o: { max: number; example?: string }) {
	return {
		doc: {
			description,
			schema: { type: 'string', pattern: ID_LIST.source, description: `Up to ${o.max} comma-separated ids` },
			...(o.example ? { example: o.example } : {})
		},
		zod: text()
			.regex(ID_LIST, 'Must be a comma-separated list of ids')
			.transform((s) => [...new Set(s.split(',').map(Number))])
			.pipe(z.array(z.number().int().positive()).max(o.max, `At most ${o.max} ids`))
			.optional()
	};
}

/** Makes an optional parameter required (missing → `Required`). */
export function required<S extends z.ZodType>(p: QueryParam<z.ZodOptional<S>>): QueryParam<S> {
	return { doc: { ...p.doc, required: true }, zod: p.zod.unwrap() };
}

export type QueryParams = Record<string, QueryParam>;
type ShapeOf<D extends QueryParams> = { [K in keyof D]: D[K]['zod'] };
/** Parsed values of a parameter set. */
export type QueryValues<D extends QueryParams> = { [K in keyof D]: z.output<D[K]['zod']> };

export interface QueryDefinition<D extends QueryParams> {
	schema: z.ZodObject<ShapeOf<D>>;
	/** OpenAPI parameter objects in declaration order. */
	parameters: OpenApiParameter[];
}

/** Zod object schema + OpenAPI parameters of an endpoint's query string. */
export function defineQuery<D extends QueryParams>(params: D): QueryDefinition<D> {
	const shape = Object.fromEntries(Object.entries(params).map(([k, p]) => [k, p.zod])) as ShapeOf<D>;
	return {
		schema: z.object(shape),
		parameters: Object.entries(params).map(([name, p]) => ({
			name,
			in: 'query' as const,
			...p.doc,
			required: p.doc.required ?? false
		}))
	};
}
