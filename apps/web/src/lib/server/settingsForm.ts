import { DEFAULT_SETTINGS, REACTORS, Settings, type ReactorProfile } from '@reactions/engine';
import type { z } from 'zod';
import { profilePath, type ProfileKey, type SystemSummary } from '$lib/settings/fields';
import { getSystemByName, getSystemsByIds } from './systems.ts';

/** Returned with `fail(400, …)`: field errors plus the submitted values so the form can redisplay them. */
export interface SettingsFormFailure {
	/** Keyed by form field name (= dotted settings path), e.g. `shared.facilityTaxPct`. */
	errors: Record<string, string>;
	/** The submitted settings; may hold out-of-range numbers (NaN for unparsable input). */
	values: Settings;
	/** Profile path → system text that did not resolve (shown again in the system field). */
	systemText: Record<string, string>;
}

export type SettingsFormResult = { ok: true; settings: Settings } | ({ ok: false } & SettingsFormFailure);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads the fields below `prefix` using `base` for shape and types: checkboxes (boolean leaves) are
 * true when present, numbers are parsed (`''`/garbage → NaN so validation reports them), and fields
 * that were not posted (e.g. disabled shipping inputs) keep their `base` value.
 */
function readFields(form: FormData, prefix: string, base: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, baseValue] of Object.entries(base)) {
		const name = prefix ? `${prefix}.${key}` : key;
		if (isPlainObject(baseValue)) {
			out[key] = readFields(form, name, baseValue);
			continue;
		}
		if (typeof baseValue === 'boolean') {
			out[key] = form.has(name);
			continue;
		}
		const raw = form.get(name);
		if (typeof raw !== 'string') out[key] = baseValue;
		else if (key === 'costIndexOverridePct') out[key] = raw.trim() === '' ? null : Number(raw);
		else if (typeof baseValue === 'number') out[key] = raw.trim() === '' ? NaN : Number(raw);
		else out[key] = raw;
	}
	return out;
}

function issueMessage(issue: z.core.$ZodIssue): string {
	switch (issue.code) {
		case 'too_small':
			return `Must be at least ${issue.minimum}`;
		case 'too_big':
			return `Must be at most ${issue.maximum}`;
		case 'invalid_type':
			return issue.expected === 'int' ? 'Enter a whole number' : 'Enter a number';
		case 'invalid_value':
			return 'Choose one of the options';
		default:
			return issue.message;
	}
}

/** Shared mode never reads `reactors` (switching to per-reactor copies the shared profile), so drop them. */
export function normalizeSettings(settings: Settings): Settings {
	return settings.mode === 'shared'
		? { ...settings, reactors: structuredClone(DEFAULT_SETTINGS.reactors) }
		: settings;
}

/** Profiles that `profileFor` reads in the settings' mode. */
export const profilesInUse = (settings: Settings): ProfileKey[] =>
	settings.mode === 'shared' ? ['shared'] : [...REACTORS];

const profileOf = (settings: Settings, key: ProfileKey): ReactorProfile =>
	key === 'shared' ? settings.shared : settings.reactors[key];

/**
 * Reference checks zod cannot do: the system must exist and allow reactions (not highsec), and every
 * hub (input, input fallback, output) must be accessible to this visitor. Keys are field names
 * (`<profile>.systemId`, …).
 */
export function referenceErrors(
	settings: Settings,
	keys: ProfileKey[],
	systems: Map<number, SystemSummary>,
	hubIds: ReadonlySet<string>
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const key of keys) {
		const p = profileOf(settings, key);
		const prefix = profilePath(key);
		const system = systems.get(p.systemId);
		if (!system) errors[`${prefix}.systemId`] = `Unknown system ${p.systemId}`;
		else if (system.securityBand === 'highsec')
			errors[`${prefix}.systemId`] =
				`${system.name} is a highsec system; reactions need low, null or J-space`;
		for (const side of ['inputHub', 'inputFallbackHub', 'outputHub'] as const) {
			if (!hubIds.has(p.market[side]))
				errors[`${prefix}.market.${side}`] = 'This market hub is not available to you';
		}
	}
	return errors;
}

/**
 * System of a profile from the form: the hidden `systemId` (set by the autocomplete) when the visible
 * text still names that system, otherwise the text itself as an id or exact name (no-JS input).
 */
async function resolveSystem(
	env: Pick<Env, 'DB'>,
	idRaw: FormDataEntryValue | null,
	textRaw: FormDataEntryValue | null
): Promise<SystemSummary | string> {
	const text = typeof textRaw === 'string' ? textRaw.trim() : '';
	const id = typeof idRaw === 'string' && /^\d+$/.test(idRaw) ? Number(idRaw) : null;
	if (id !== null) {
		const byId = (await getSystemsByIds(env, [id])).get(id);
		if (byId && (text === '' || text.toLowerCase() === byId.name.toLowerCase())) return byId;
	}
	if (text === '') return 'Choose a system';
	const found = /^\d+$/.test(text)
		? ((await getSystemsByIds(env, [Number(text)])).get(Number(text)) ?? null)
		: await getSystemByName(env, text);
	return found ?? `Unknown system "${text}"`;
}

/**
 * Parses and validates a `/settings` save. `editing` (hidden field) says which profiles the form showed:
 * - `shared` + mode `per_reactor`: the visitor just switched modes, so the shared profile is copied
 *   into all three reactors (errors are reported on every reactor tab);
 * - `per_reactor` + mode `per_reactor`: the three reactor profiles are read;
 * - `per_reactor` + mode `shared` (switch back without JS): the stored shared profile is kept.
 */
export async function parseSettingsForm(
	env: Pick<Env, 'DB'>,
	form: FormData,
	current: Settings,
	hubIds: ReadonlySet<string>
): Promise<SettingsFormResult> {
	const global = readFields(form, '', {
		mode: current.mode,
		cycleDays: current.cycleDays,
		slotAllocation: current.slotAllocation,
		maxParallelLines: current.maxParallelLines,
		defaultView: current.defaultView,
		defaultOutput: current.defaultOutput,
		unrefinedInChains: current.unrefinedInChains,
		reprocessing: current.reprocessing
	});
	const mode: Settings['mode'] = global.mode === 'per_reactor' ? 'per_reactor' : 'shared';
	const editing = form.get('editing') === 'per_reactor' ? 'per_reactor' : 'shared';
	const sourceKeys: ProfileKey[] =
		editing === 'shared' ? ['shared'] : mode === 'per_reactor' ? [...REACTORS] : [];

	const errors: Record<string, string> = {};
	const systemText: Record<string, string> = {};
	const systems = new Map<number, SystemSummary>();
	const read = {} as Record<ProfileKey, ReactorProfile>;
	for (const key of sourceKeys) {
		const prefix = profilePath(key);
		const base = profileOf(current, key);
		const profile = readFields(form, prefix, base) as ReactorProfile;
		const system = await resolveSystem(env, form.get(`${prefix}.systemId`), form.get(`${prefix}.system`));
		if (typeof system === 'string') {
			errors[`${prefix}.systemId`] = system;
			profile.systemId = base.systemId;
		} else {
			systems.set(system.id, system);
			profile.systemId = system.id;
		}
		read[key] = profile;
	}

	const copyShared = editing === 'shared' && mode === 'per_reactor';
	const draft = {
		v: 1,
		mode,
		shared: read.shared ?? current.shared,
		reactors:
			mode === 'shared'
				? structuredClone(DEFAULT_SETTINGS.reactors)
				: copyShared
					? Object.fromEntries(REACTORS.map((r) => [r, structuredClone(read.shared)]))
					: { biochemical: read.biochemical, composite: read.composite, hybrid: read.hybrid },
		cycleDays: global.cycleDays,
		slotAllocation: global.slotAllocation,
		maxParallelLines: global.maxParallelLines,
		defaultView: global.defaultView,
		defaultOutput: global.defaultOutput,
		unrefinedInChains: global.unrefinedInChains,
		reprocessing: global.reprocessing
	} as Settings;

	const parsed = Settings.safeParse(draft);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issueMessage(issue);
	}
	const resolvedKeys = sourceKeys.filter((key) => !errors[`${profilePath(key)}.systemId`]);
	Object.assign(errors, { ...referenceErrors(draft, resolvedKeys, systems, hubIds), ...errors });

	if (Object.keys(errors).length === 0 && parsed.success) return { ok: true, settings: parsed.data };
	// A rejected system (e.g. highsec) is shown again exactly as the visitor typed it.
	for (const key of sourceKeys) {
		const prefix = profilePath(key);
		if (errors[`${prefix}.systemId`]) systemText[prefix] ??= String(form.get(`${prefix}.system`) ?? '');
	}
	if (copyShared) {
		for (const [name, message] of Object.entries(errors)) {
			if (!name.startsWith('shared.')) continue;
			for (const r of REACTORS) errors[`reactors.${r}.${name.slice('shared.'.length)}`] = message;
		}
		if (systemText.shared !== undefined)
			for (const r of REACTORS) systemText[`reactors.${r}`] = systemText.shared;
	}
	return { ok: false, errors, values: draft, systemText };
}

/** Systems referenced by any profile of the given settings, keyed by id. */
export async function systemsFor(
	env: Pick<Env, 'DB'>,
	list: Settings[]
): Promise<Map<number, SystemSummary>> {
	const ids = list.flatMap((s) => [s.shared.systemId, ...REACTORS.map((r) => s.reactors[r].systemId)]);
	return getSystemsByIds(env, ids);
}
