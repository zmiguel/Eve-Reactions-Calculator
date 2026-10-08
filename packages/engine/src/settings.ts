import { z } from 'zod';
import type { Reactor, SecurityBand } from './types.ts';

export const Shipping = z
	.object({
		enabled: z.boolean().default(false),
		iskPerM3: z.number().min(0).max(1e6).default(0),
		collateralPct: z.number().min(0).max(100).default(0),
		/** Global discount on the whole shipping price (e.g. a hauling service's volume discount). */
		discountPct: z.number().min(0).max(100).default(0)
	})
	.prefault({});

export const MarketSettings = z
	.object({
		inputHub: z.string().default('jita'),
		/** Where the part of an input the input hub does not list (market purchases) is bought. */
		inputFallbackHub: z.string().default('jita'),
		outputHub: z.string().default('jita'),
		inputMethod: z.enum(['buy_order', 'instant', 'contract']).default('buy_order'),
		outputMethod: z.enum(['sell_order', 'instant', 'contract']).default('sell_order'),
		inputContractBasis: z.enum(['buy', 'sell', 'split']).default('split'),
		outputContractBasis: z.enum(['buy', 'sell', 'split']).default('split'),
		inputPricePct: z.number().min(50).max(150).default(100),
		outputPricePct: z.number().min(50).max(150).default(100),
		brokerFeePct: z.number().min(0).max(10).default(1.5),
		salesTaxPct: z.number().min(0).max(10).default(3.6)
	})
	.prefault({});

export const ReactorProfile = z.object({
	structure: z.enum(['athanor', 'tatara']).default('tatara'),
	meRig: z.enum(['none', 't1', 't2']).default('t2'),
	teRig: z.enum(['none', 't1', 't2']).default('t2'),
	systemId: z.number().int().default(30002647),
	costIndexOverridePct: z.number().min(0).max(100).nullable().default(null),
	facilityTaxPct: z.number().min(0).max(50).default(1),
	sccPct: z.number().min(0).max(20).default(4),
	reactionsSkill: z.number().int().min(1).max(5).default(5),
	market: MarketSettings,
	shipping: z.object({ input: Shipping, output: Shipping }).prefault({})
});

/** Highest `maxParallelLines` setting. */
export const MAX_PARALLEL_LINES = 10;

export const Settings = z.object({
	v: z.literal(1).default(1),
	mode: z.enum(['shared', 'per_reactor']).default('shared'),
	shared: ReactorProfile.prefault({}),
	reactors: z
		.object({
			biochemical: ReactorProfile.prefault({}),
			composite: ReactorProfile.prefault({}),
			hybrid: ReactorProfile.prefault({})
		})
		.prefault({}),
	cycleDays: z.number().min(0.25).max(30).default(7),
	/** Full chains: `single` = one line, jobs back to back in one slot; `optimal` = parallel lines filling every slot. */
	slotAllocation: z.enum(['single', 'optimal']).default('single'),
	/** Optimal slots tries 1 to this many final-product lines per chain. */
	maxParallelLines: z.number().int().min(1).max(MAX_PARALLEL_LINES).default(4),
	/** Tab reaction lists and pages open on where a full chain exists: buy every input, or the full chain. */
	defaultView: z.enum(['single', 'chain']).default('single'),
	/** Tab reaction lists and pages open on where reprocessing applies: sell the product, or reprocess it. */
	defaultOutput: z.enum(['product', 'reprocessed']).default('product'),
	/**
	 * Full chains everywhere (lists, home, planner, API, the reaction page's Full chain): `never` uses the
	 * regular reactions only; `best` builds an intermediate through its unrefined reaction and
	 * reprocessing where that improves the chain (see `chooseUnrefined`). The reaction page's "Using
	 * unrefined" view always does.
	 */
	unrefinedInChains: z.enum(['never', 'best']).default('never'),
	reprocessing: z
		.object({
			unrefinedYieldPct: z.number().min(0).max(100).default(55),
			prismaticiteYieldPct: z.number().min(0).max(100).default(90.63),
			prismaticiteRollPct: z.number().min(0).max(100).default(50)
		})
		.prefault({})
});

export type Settings = z.infer<typeof Settings>;
export type ReactorProfile = z.infer<typeof ReactorProfile>;
export type SlotAllocation = Settings['slotAllocation'];
export type MarketSettings = z.infer<typeof MarketSettings>;
export type ShippingSettings = z.infer<typeof Shipping>;
export type InputMethod = MarketSettings['inputMethod'];
export type OutputMethod = MarketSettings['outputMethod'];
export type ContractBasis = MarketSettings['inputContractBasis'];
export type RigLevel = ReactorProfile['meRig'];
export type Structure = ReactorProfile['structure'];

/** A reactor profile with its system resolved server-side (security band, cost index). */
export type ResolvedProfile = ReactorProfile & {
	securityBand: SecurityBand;
	/** Fraction, e.g. 0.0412 for 4.12 %. */
	costIndex: number;
	systemName: string;
	costIndexMissing: boolean;
};

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

export const REACTORS: readonly Reactor[] = ['biochemical', 'composite', 'hybrid'];

export function profileFor(settings: Settings, reactor: Reactor): ReactorProfile {
	return settings.mode === 'shared' ? settings.shared : settings.reactors[reactor];
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Writes `bytes` through a (de)compression stream; uses only types common to DOM and workers libs. */
async function pipeBytes(
	bytes: Uint8Array<ArrayBuffer>,
	transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array<ArrayBuffer>> }
): Promise<Uint8Array> {
	const writer = transform.writable.getWriter();
	const written = writer.write(bytes).then(() => writer.close());
	const [out] = await Promise.all([new Response(transform.readable).arrayBuffer(), written]);
	return new Uint8Array(out);
}

/** JSON → deflate-raw → base64url. Used for compact cookies and share links. */
export async function encodeJson(value: unknown): Promise<string> {
	// Copy: workers types declare `encode()` as `Uint8Array<ArrayBufferLike>`.
	const json = new Uint8Array(new TextEncoder().encode(JSON.stringify(value)));
	return toBase64Url(await pipeBytes(json, new CompressionStream('deflate-raw')));
}

/** Largest decoded JSON {@link decodeJson} accepts by default (settings are well under 4 KiB). */
export const MAX_DECODED_BYTES = 64 * 1024;

/** Reads a decompression stream, giving up (null) once more than `maxBytes` came out. */
async function readBounded(
	readable: ReadableStream<Uint8Array>,
	maxBytes: number
): Promise<Uint8Array | null> {
	const reader = readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/**
 * Inverse of {@link encodeJson}; returns `null` on any decoding failure. Untrusted input (cookies,
 * share links, API bodies) is bounded: codes longer than `maxBytes` characters and payloads that
 * inflate beyond `maxBytes` are rejected without buffering them.
 */
export async function decodeJson(text: string, maxBytes = MAX_DECODED_BYTES): Promise<unknown> {
	if (text.length > maxBytes) return null;
	try {
		const transform = new DecompressionStream('deflate-raw');
		const writer = transform.writable.getWriter();
		// A rejected write (bad data or a cancelled read) surfaces through the reader or the parse below.
		writer
			.write(fromBase64Url(text))
			.then(() => writer.close())
			.catch(() => {});
		const bytes = await readBounded(transform.readable, maxBytes);
		return bytes === null ? null : JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Settings holding only the leaves that differ from a base; nested objects appear only when non-empty. */
export type SettingsDiff = DeepPartial<Settings>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Leaves of `value` that differ from `base`; `undefined` when equal. */
function diffValue(value: unknown, base: unknown): unknown {
	if (isPlainObject(value) && isPlainObject(base)) {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			const child = diffValue(value[key], base[key]);
			if (child !== undefined) out[key] = child;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}
	return Object.is(value, base) ? undefined : value;
}

/**
 * Sparse form of `settings`: only the values that differ from `base` (default {@link DEFAULT_SETTINGS}).
 * `Settings.parse(diff)` restores the full object, filling every other field from the current defaults,
 * so improved defaults reach everyone who did not override that field.
 */
export function settingsDiff(settings: Settings, base: Settings = DEFAULT_SETTINGS): SettingsDiff {
	return (diffValue(settings, base) ?? {}) as SettingsDiff;
}

export function isDefaultSettings(settings: Settings): boolean {
	return diffValue(settings, DEFAULT_SETTINGS) === undefined;
}

/** The versioned sparse value kept in the cookie, the account and share links: `{ v, ...diff }`. */
export function storedSettings(settings: Settings): SettingsDiff {
	return { ...settingsDiff(settings), v: settings.v };
}

/** Encodes {@link storedSettings} (JSON → deflate-raw → base64url). */
export function encodeSettings(settings: Settings): Promise<string> {
	return encodeJson(storedSettings(settings));
}

/**
 * Decodes a sparse diff (or a legacy full object) and merges it onto the current defaults; `null` on
 * any decoding failure or schema violation.
 */
export async function decodeSettings(text: string): Promise<Settings | null> {
	if (!text) return null;
	const value = await decodeJson(text);
	if (!isPlainObject(value)) return null;
	const parsed = Settings.safeParse(value);
	return parsed.success ? parsed.data : null;
}
