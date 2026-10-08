import { getCoreDb, users } from '@reactions/db';
import { DEFAULT_CONSTANTS, DEFAULT_SETTINGS, decodeSettings, encodeSettings } from '@reactions/engine';
import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDataset } from '$lib/server/data';
import { getAccessibleHubs } from '$lib/server/hubs';
import { persistSettings } from '$lib/server/settings';
import {
	normalizeSettings,
	parseSettingsForm,
	profilesInUse,
	referenceErrors,
	systemsFor
} from '$lib/server/settingsForm';
import { describePath, settingsChanges, type SettingsChange, type SystemSummary } from '$lib/settings/fields';
import type { Actions, PageServerLoad } from './$types';

const NOTICES = ['saved', 'reset', 'imported'] as const;
type Notice = (typeof NOTICES)[number];

const INVALID_IMPORT = 'This share link is not valid (it may be truncated). Your settings were not changed.';

function requireEnv(platform: App.Platform | undefined): Env {
	if (!platform) error(503, 'Settings cannot be saved right now.');
	return platform.env;
}

/** Problems of imported settings as sentences, e.g. `Composite · System: Jita is a highsec system…`. */
function importProblems(errors: Record<string, string>): string[] {
	return Object.entries(errors).map(([path, message]) => {
		const { scope, label } = describePath(path);
		return `${scope} · ${label}: ${message}`;
	});
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const env = platform?.env;
	const settings = locals.settings;
	const importCode = url.searchParams.get('import');
	const decoded = importCode ? await decodeSettings(importCode) : null;
	const imported = decoded ? normalizeSettings(decoded) : null;

	const [hubs, systems, dataset, account] = env
		? await Promise.all([
				getAccessibleHubs(env, locals.user),
				systemsFor(env, imported ? [settings, imported] : [settings]),
				getDataset(env),
				locals.user
					? getCoreDb(env.DB)
							.select({ updatedAt: users.settingsUpdatedAt })
							.from(users)
							.where(eq(users.userId, locals.user.userId))
							.then(([row]) => ({ updatedAt: row?.updatedAt ?? null }))
					: null
			])
		: [[], new Map<number, SystemSummary>(), null, null];

	let importPreview: { code: string; changes: SettingsChange[]; problems: string[] } | null = null;
	if (importCode && imported) {
		const names: Record<string, string> = Object.fromEntries(hubs.map((h) => [h.hubId, h.name]));
		for (const s of systems.values()) names[`system:${s.id}`] = s.name;
		const hubIds = new Set(hubs.map((h) => h.hubId));
		importPreview = {
			code: importCode,
			changes: settingsChanges(settings, imported, names),
			problems: importProblems(referenceErrors(imported, profilesInUse(imported), systems, hubIds))
		};
	}

	const notice = url.searchParams.get('notice');
	return {
		settings,
		hubs: hubs.map((h) => ({ hubId: h.hubId, name: h.name, private: h.private })),
		systems: Object.fromEntries(systems) as Record<number, SystemSummary>,
		constants: dataset?.constants ?? DEFAULT_CONSTANTS,
		account,
		shareCode: await encodeSettings(settings),
		notice: NOTICES.includes(notice as Notice) ? (notice as Notice) : null,
		importPreview,
		importInvalid: importCode !== null && imported === null ? INVALID_IMPORT : null
	};
};

export const actions: Actions = {
	save: async ({ request, locals, platform, cookies }) => {
		const env = requireEnv(platform);
		const hubs = await getAccessibleHubs(env, locals.user);
		const result = await parseSettingsForm(
			env,
			await request.formData(),
			locals.settings,
			new Set(hubs.map((h) => h.hubId))
		);
		if (!result.ok) {
			const { errors, values, systemText } = result;
			return fail(400, { errors, values, systemText });
		}
		await persistSettings(env, cookies, locals.user?.userId ?? null, result.settings);
		redirect(303, '/settings?notice=saved');
	},

	reset: async ({ locals, platform, cookies }) => {
		const env = requireEnv(platform);
		await persistSettings(env, cookies, locals.user?.userId ?? null, DEFAULT_SETTINGS);
		redirect(303, '/settings?notice=reset');
	},

	import: async ({ request, locals, platform, cookies }) => {
		const env = requireEnv(platform);
		const code = (await request.formData()).get('code');
		const decoded = typeof code === 'string' ? await decodeSettings(code) : null;
		if (!decoded) return fail(400, { importError: INVALID_IMPORT });
		const settings = normalizeSettings(decoded);
		const [hubs, systems] = await Promise.all([
			getAccessibleHubs(env, locals.user),
			systemsFor(env, [settings])
		]);
		const problems = importProblems(
			referenceErrors(settings, profilesInUse(settings), systems, new Set(hubs.map((h) => h.hubId)))
		);
		if (problems.length > 0) {
			return fail(400, {
				importError: `These settings cannot be applied: ${problems.join('; ')}. Your settings were not changed.`
			});
		}
		await persistSettings(env, cookies, locals.user?.userId ?? null, settings);
		redirect(303, '/settings?notice=imported');
	}
};
