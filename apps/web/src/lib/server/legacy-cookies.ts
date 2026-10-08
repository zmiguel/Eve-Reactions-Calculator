import { DEFAULT_SETTINGS, REACTORS, Settings } from '@reactions/engine';
import type { Reactor, ReactorProfile } from '@reactions/engine';
import type { Cookies } from '@sveltejs/kit';
import { deleteCookie } from './cookies.ts';
import { getSystemByName } from './systems.ts';

/**
 * Cookies of the v2 site (host-only, path `/`): the settings form wrote every field per suffix
 * (`''` in single mode, `_<reactor>` in separate mode), the reactor pages wrote `cycles` and their
 * submit button `submit` with the same suffixes, and the layout wrote `settingsMode` and `partner`.
 */
const V2_FIELDS = [
	'input',
	'inMarket',
	'output',
	'outMarket',
	'brokers',
	'sales',
	'skill',
	'facility',
	'rigs',
	'space',
	'system',
	'indyTax',
	'sccTax',
	'duration',
	'cycles',
	'costIndex',
	'prismaticite',
	'submit'
] as const;
type V2Field = (typeof V2_FIELDS)[number];

const V2_SUFFIXES = ['', ...REACTORS.map((r) => `_${r}`)];

export const V2_COOKIES: ReadonlySet<string> = new Set([
	'settingsMode',
	'partner',
	...V2_FIELDS.flatMap((field) => V2_SUFFIXES.map((suffix) => field + suffix))
]);

/** What v2 wrote into the cookies on every visit; such values were not chosen and are not converted. */
const V2_DEFAULTS: Partial<Record<V2Field, string>> = {
	input: 'buy',
	inMarket: 'Jita',
	output: 'sell',
	outMarket: 'Jita',
	brokers: '3',
	sales: '3.6',
	skill: '5',
	facility: 'large',
	rigs: '2',
	space: 'nullsec',
	system: 'Ignoitton',
	indyTax: '1',
	sccTax: '4',
	duration: '10080',
	costIndex: '0',
	prismaticite: '50'
};

const HUBS: Record<string, string> = { Jita: 'jita', Amarr: 'amarr', Perimeter: 'perimeter' };
const RIGS: Record<string, ReactorProfile['meRig']> = { '0': 'none', '1': 't1', '2': 't2' };

/** Reads the v2 cookies of the request and deletes them (Set-Cookie with max-age 0). */
export function takeLegacyCookies(cookies: Cookies): Map<string, string> {
	const legacy = new Map<string, string>();
	for (const { name, value } of cookies.getAll()) {
		if (V2_COOKIES.has(name)) legacy.set(name, value);
	}
	for (const name of legacy.keys()) deleteCookie(cookies, name);
	return legacy;
}

function parseNumber(raw: string): number | null {
	const text = raw.trim();
	if (text === '') return null;
	const n = Number(text);
	return Number.isFinite(n) ? n : null;
}

/** `true` when `raw` is what v2 wrote by default for `field`. */
function isV2Default(field: V2Field, raw: string): boolean {
	const fallback = V2_DEFAULTS[field];
	if (fallback === undefined) return false;
	if (parseNumber(raw) === Number(fallback)) return true;
	if (field === 'system') return raw.trim().toLowerCase() === fallback.toLowerCase();
	return raw === fallback;
}

/** Applies `patch` to a copy of `settings` when the result is valid; otherwise returns `settings`. */
function tryApply(settings: Settings, patch: (draft: Settings) => void): Settings {
	const draft = structuredClone(settings);
	patch(draft);
	const parsed = Settings.safeParse(draft);
	return parsed.success ? parsed.data : settings;
}

/**
 * The v3 settings v2's cookies describe (see the conversion table in the tests). A field is converted
 * only when it differs from v2's default, and each unparseable, unknown or out-of-range value is
 * skipped on its own. `settingsMode=separate` → `per_reactor`, each reactor reading its `_<reactor>`
 * cookie and falling back to the unsuffixed one (as v2's settings page did); the shared profile comes
 * from the unsuffixed cookies. Global fields (`duration`, `prismaticite`) take the first convertible
 * value in `REACTORS` order in separate mode. Systems are resolved by exact name; unknown and highsec
 * systems keep the default.
 */
export async function convertLegacySettings(
	env: Pick<Env, 'DB'>,
	legacy: ReadonlyMap<string, string>
): Promise<Settings> {
	const separate = legacy.get('settingsMode') === 'separate';
	/** The non-default value of `field` for `suffix`, with v2's fallback to the unsuffixed cookie. */
	const valueOf = (field: V2Field, suffix: string): string | undefined => {
		const raw = (suffix && legacy.get(field + suffix)) || legacy.get(field);
		return raw === undefined || raw === '' || isV2Default(field, raw) ? undefined : raw;
	};
	const numberOf = (field: V2Field, suffix: string): number | null => {
		const raw = valueOf(field, suffix);
		return raw === undefined ? null : parseNumber(raw);
	};

	let settings: Settings = structuredClone(DEFAULT_SETTINGS);
	if (separate) settings.mode = 'per_reactor';

	const keys: ('shared' | Reactor)[] = separate ? ['shared', ...REACTORS] : ['shared'];
	const systemIds = new Map<string, number | null>();
	for (const key of keys) {
		const suffix = key === 'shared' ? '' : `_${key}`;
		const apply = (patch: (profile: ReactorProfile) => void) => {
			settings = tryApply(settings, (draft) => patch(key === 'shared' ? draft.shared : draft.reactors[key]));
		};

		const input = valueOf('input', suffix);
		if (input === 'sell') apply((p) => (p.market.inputMethod = 'instant'));
		const output = valueOf('output', suffix);
		if (output === 'buy') apply((p) => (p.market.outputMethod = 'instant'));
		const inHub = HUBS[valueOf('inMarket', suffix) ?? ''];
		if (inHub) apply((p) => (p.market.inputHub = inHub));
		const outHub = HUBS[valueOf('outMarket', suffix) ?? ''];
		if (outHub) apply((p) => (p.market.outputHub = outHub));

		const broker = numberOf('brokers', suffix);
		if (broker !== null) apply((p) => (p.market.brokerFeePct = broker));
		const sales = numberOf('sales', suffix);
		if (sales !== null) apply((p) => (p.market.salesTaxPct = sales));
		const skill = numberOf('skill', suffix);
		if (skill !== null) apply((p) => (p.reactionsSkill = skill));
		const facilityTax = numberOf('indyTax', suffix);
		if (facilityTax !== null) apply((p) => (p.facilityTaxPct = facilityTax));
		const scc = numberOf('sccTax', suffix);
		if (scc !== null) apply((p) => (p.sccPct = scc));

		if (valueOf('facility', suffix) === 'medium') apply((p) => (p.structure = 'athanor'));
		const rig = RIGS[valueOf('rigs', suffix) ?? ''];
		if (rig) {
			apply((p) => {
				p.meRig = rig;
				p.teRig = rig;
			});
		}

		const space = (suffix && legacy.get(`space${suffix}`)) || legacy.get('space');
		const costIndex = numberOf('costIndex', suffix);
		if (space === 'wormhole' && costIndex !== null && costIndex > 0) {
			apply((p) => (p.costIndexOverridePct = costIndex));
		}

		const systemName = valueOf('system', suffix)?.trim().toLowerCase();
		if (systemName) {
			if (!systemIds.has(systemName)) {
				const system = await getSystemByName(env, systemName);
				systemIds.set(systemName, system && system.securityBand !== 'highsec' ? system.id : null);
			}
			const systemId = systemIds.get(systemName);
			if (typeof systemId === 'number') apply((p) => (p.systemId = systemId));
		}
	}

	const globalSuffixes = separate ? REACTORS.map((r) => `_${r}`) : [''];
	const applyGlobal = (field: V2Field, patch: (draft: Settings, value: number) => void) => {
		for (const suffix of globalSuffixes) {
			const value = numberOf(field, suffix);
			if (value === null) continue;
			const next = tryApply(settings, (draft) => patch(draft, value));
			if (next !== settings) {
				settings = next;
				return;
			}
		}
	};
	applyGlobal('duration', (draft, minutes) => (draft.cycleDays = minutes / 1440));
	applyGlobal('prismaticite', (draft, pct) => (draft.reprocessing.prismaticiteRollPct = pct));

	return Settings.parse(settings);
}
