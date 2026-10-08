import { Settings, decodeJson, encodeJson, storedSettings } from '@reactions/engine';
import { z } from 'zod';
import { FILL_SCOPE_IDS } from './plan';

/** localStorage key; the version suffix changes together with {@link STATE_VERSION}. */
export const STORAGE_KEY = 'planner:v1';
export const STATE_VERSION = 1;
/** One character with Mass Reactions V and Advanced Mass Reactions V. */
export const DEFAULT_SLOTS = 11;
export const MAX_SLOTS = 10_000;
export const MAX_LINES = 1_000;
/** Largest quantity target (units per cycle). */
export const MAX_QUANTITY = 1e12;
export const DEFAULT_MAX_VOLUME_PCT = 10;

// Fields added after the first release are optional or defaulted, so older v1 states still parse.
const PlannerStateSchema = z.object({
	v: z.literal(STATE_VERSION),
	slots: z.number().int().min(0).max(MAX_SLOTS),
	/** `null` = the cycle length from the visitor's settings. */
	cycleDays: z.number().min(0.25).max(30).nullable(),
	targets: z
		.array(
			z.object({
				blueprintTypeId: z.number().int().positive(),
				/** Kept while in quantity mode so switching back restores it. */
				lines: z.number().int().min(1).max(MAX_LINES),
				/** Units per cycle; present = quantity mode. */
				quantity: z.number().int().positive().max(MAX_QUANTITY).optional()
			})
		)
		.max(500),
	/** Product type ids bought instead of built. */
	buy: z.array(z.number().int().positive()).max(1_000),
	/** Pasted stock (`Name<TAB>Qty` lines) as typed; parsed against the dataset on use. */
	stockText: z.string().max(200_000),
	/** Pasted owned formulas, same format. */
	formulasText: z.string().max(50_000),
	/** Auto-fill keeps each product's sales per day within this % of its region's daily volume. */
	maxVolumePct: z.number().min(1).max(100).default(DEFAULT_MAX_VOLUME_PCT),
	/** Reactions auto-fill may pick. */
	fillScope: z.enum(FILL_SCOPE_IDS).default('all')
});

export type PlannerState = z.infer<typeof PlannerStateSchema>;

export const emptyState = (): PlannerState => ({
	v: STATE_VERSION,
	slots: DEFAULT_SLOTS,
	cycleDays: null,
	targets: [],
	buy: [],
	stockText: '',
	formulasText: '',
	maxVolumePct: DEFAULT_MAX_VOLUME_PCT,
	fillScope: 'all'
});

/** A valid state of the current version, or `null` (other versions and garbage are rejected). */
export function parseState(value: unknown): PlannerState | null {
	const parsed = PlannerStateSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Stored state; a missing, unreadable, invalid or other-version entry yields the empty state. */
export function loadState(storage: Pick<Storage, 'getItem'> | undefined): PlannerState {
	try {
		const text = storage?.getItem(STORAGE_KEY);
		return (text && parseState(JSON.parse(text))) || emptyState();
	} catch {
		return emptyState();
	}
}

/** Writes the state; storage errors (quota, privacy mode) are ignored. */
export function saveState(storage: Pick<Storage, 'setItem'> | undefined, state: PlannerState): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Not persisting is acceptable: the share link still carries the plan.
	}
}

/** A decoded share link: the plan and, for links that carry them, the sharer's settings. */
export interface SharedPlan {
	state: PlannerState;
	/** `null` for links without settings (or with invalid ones): the viewer's settings apply. */
	settings: Settings | null;
}

/**
 * Share code for `/planner?s=<code>`: the state plus, when given, the settings it was planned with as
 * an optional `settings` field (the sparse `{ v, ...diff }` form of the settings cookie and import
 * links), as deflate-raw base64url JSON.
 */
export function encodeShare(state: PlannerState, settings: Settings | null = null): Promise<string> {
	return encodeJson(settings ? { ...state, settings: storedSettings(settings) } : state);
}

/** Planner states carry pasted stock and formula text, so share codes may inflate further than settings. */
const MAX_SHARE_BYTES = 512 * 1024;

/**
 * Inverse of {@link encodeShare}; `null` for undecodable, oversized or invalid plans. Invalid settings
 * are dropped and the plan is kept.
 */
export async function decodeShare(code: string): Promise<SharedPlan | null> {
	const value = await decodeJson(code, MAX_SHARE_BYTES);
	const state = parseState(value);
	if (!state) return null;
	const settings =
		typeof value === 'object' && value !== null && 'settings' in value
			? Settings.safeParse(value.settings)
			: null;
	return { state, settings: settings?.success ? settings.data : null };
}
