import { TrackingSettings } from '@reactions/engine';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { getDataset } from '$lib/server/data';
import { getAccessibleHubs } from '$lib/server/hubs';
import { requestLedgerRebuild } from '$lib/server/ledger-rebuild';
import {
	facilitySettingsFromForm,
	getTrackingSettings,
	listFacilities,
	listUnreadBlueprints,
	saveTrackingSettings,
	trackingSettingsPage,
	type TrackingSettingsPageData
} from '$lib/server/tracking-settings';
import type { Actions, PageServerLoad } from './$types';

const LOGIN_URL = '/auth/login?purpose=login&returnTo=%2Faccount%2Ftracking';

function requireAccount({ locals, platform }: Pick<RequestEvent, 'locals' | 'platform'>) {
	if (!locals.user) redirect(303, LOGIN_URL);
	if (!platform) error(503, 'Your account is not available right now.');
	return { env: platform.env, user: locals.user };
}

/**
 * Saving asks the updater to rebuild the ledger, so it is limited per account like the other actions
 * that start updater work (`ACCOUNT_RATE_LIMITER`, shared key with Connections); skipped when the
 * binding is absent.
 */
async function throttled(env: Env, userId: string): Promise<boolean> {
	const limiter = env.ACCOUNT_RATE_LIMITER as RateLimit | undefined;
	if (!limiter) return false;
	return !(await limiter.limit({ key: `inventory:${userId}` })).success;
}

const TOO_MANY = 'Too many requests. Wait a minute and try again.';

/** Stores `settings`, then rebuilds the ledger (or marks it for the next pass). */
async function saveAndRebuild(env: Env, userId: string, settings: TrackingSettings) {
	await saveTrackingSettings(env, userId, settings);
	const { rebuilt } = await requestLedgerRebuild(env, userId);
	return {
		notice: rebuilt ? 'Saved. Results recalculated.' : 'Saved. Results are recalculated within 10 minutes.'
	};
}

export const load: PageServerLoad = async (event): Promise<TrackingSettingsPageData> => {
	const { env, user } = requireAccount(event);
	return trackingSettingsPage(env, user);
};

export const actions: Actions = {
	contracts: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const current = await getTrackingSettings(env, user.userId);
		const parsed = TrackingSettings.safeParse({
			...current,
			contractRule: {
				hubId: String(form.get('hubId') ?? ''),
				basis: form.get('basis'),
				expectedPct: Number(form.get('expectedPct') || NaN),
				tolerancePct: Number(form.get('tolerancePct') || NaN)
			}
		});
		if (!parsed.success) {
			return fail(400, {
				form: 'contracts' as const,
				error: 'Enter an expected % from 1 to 200 and a tolerance from 0 to 50, and pick a basis.'
			});
		}
		const hubs = await getAccessibleHubs(env, user);
		if (!hubs.some((h) => h.hubId === parsed.data.contractRule.hubId)) {
			return fail(400, { form: 'contracts' as const, error: 'This market hub is not available to you.' });
		}
		if (await throttled(env, user.userId)) return fail(429, { form: 'contracts' as const, error: TOO_MANY });
		return { form: 'contracts' as const, ...(await saveAndRebuild(env, user.userId, parsed.data)) };
	},

	/**
	 * What EVE could not tell about the facilities of the user's tracked jobs: posted facilities are
	 * merged into the stored ones (see `facilitySettingsFromForm`).
	 */
	facilities: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const [current, dataset] = await Promise.all([getTrackingSettings(env, user.userId), getDataset(env)]);
		const listed = await listFacilities(env, user.userId, dataset, current);
		const result = facilitySettingsFromForm(form, listed, current.facilities);
		if (!result.ok) return fail(400, { form: 'facilities' as const, error: result.error });
		const parsed = TrackingSettings.safeParse({ ...current, facilities: result.facilities });
		if (!parsed.success) {
			return fail(400, {
				form: 'facilities' as const,
				error: 'Pick a structure and rigs from the lists.'
			});
		}
		if (await throttled(env, user.userId)) return fail(429, { form: 'facilities' as const, error: TOO_MANY });
		return { form: 'facilities' as const, ...(await saveAndRebuild(env, user.userId, parsed.data)) };
	},

	/** The period the Overview and Jobs tabs open on: display only, no recalculation. */
	period: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const current = await getTrackingSettings(env, user.userId);
		const parsed = TrackingSettings.safeParse({ ...current, defaultPeriod: form.get('defaultPeriod') });
		if (!parsed.success) return fail(400, { form: 'period' as const, error: 'Pick a period from the list.' });
		await saveTrackingSettings(env, user.userId, parsed.data);
		return { form: 'period' as const, notice: 'Saved.' };
	},

	/**
	 * How reaction output used by manufacturing jobs counts, and the ME assumed for blueprints that could
	 * not be read. Posted blueprints are merged into the stored ones; each must be one of the user's
	 * manufacturing jobs' without a read ME.
	 */
	manufacturing: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const [current, blueprints] = await Promise.all([
			getTrackingSettings(env, user.userId),
			listUnreadBlueprints(env, user.userId)
		]);
		const knownBlueprints = new Set(blueprints.map((b) => b.blueprintTypeId));
		const blueprintMe: Record<string, number> = { ...current.blueprintMe };
		for (const [key, value] of form) {
			const blueprint = /^me-(.+)$/.exec(key)?.[1];
			if (blueprint === undefined) continue;
			if (!knownBlueprints.has(blueprint)) {
				return fail(400, {
					form: 'manufacturing' as const,
					error: 'That blueprint is not among your manufacturing jobs.'
				});
			}
			blueprintMe[blueprint] = value === '' ? NaN : Number(value);
		}
		const parsed = TrackingSettings.safeParse({
			...current,
			manufacturingUse: form.get('manufacturingUse') ?? current.manufacturingUse,
			blueprintMe
		});
		if (!parsed.success) {
			return fail(400, {
				form: 'manufacturing' as const,
				error: 'Pick how used output counts, and enter an ME from 0 to 10.'
			});
		}
		if (await throttled(env, user.userId))
			return fail(429, { form: 'manufacturing' as const, error: TOO_MANY });
		return { form: 'manufacturing' as const, ...(await saveAndRebuild(env, user.userId, parsed.data)) };
	}
};
