import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { ConnectionsPageData } from '#lib/inventory/types.js';
import { getCharacter } from '#lib/server/auth/accounts.js';
import {
	addSource,
	getSource,
	removeReader,
	removeSource,
	requestInventorySync,
	type SyncRequest
} from '#lib/server/inventory.js';
import { TOO_MANY, throttled } from '#lib/server/ledger-actions.js';
import { requestLedgerRebuild } from '#lib/server/ledger-rebuild.js';
import {
	connectionsPage,
	requestTrackingSync,
	saveWalletDivisions,
	setSwitch,
	type ConnectionOutcome
} from '#lib/server/tracking-connections.js';
import type { Actions, PageServerLoad } from './$types';

const LOGIN_URL = '/auth/login?purpose=login&returnTo=%2Faccount%2Fconnections';

function requireAccount({ locals }: Pick<RequestEvent, 'locals'>) {
	if (!locals.user) redirect(303, LOGIN_URL);
	return { env: locals.env, user: locals.user };
}

const positiveInt = (value: FormDataEntryValue | null) => {
	const n = Number(value);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const NOT_YOURS = 'That connection is not on your list.';

/** The action result of a switch or wallet divisions outcome. */
function outcomeResult(outcome: ConnectionOutcome) {
	if (outcome.ok) return { notice: outcome.notice };
	return fail(
		outcome.status,
		outcome.allow ? { error: outcome.message, allow: outcome.allow } : { error: outcome.message }
	);
}

/** "<Owner> added. Inventory sync started." and the like, for the syncs a new connection asked for. */
function addedNotice(ownerName: string, syncs: { name: string; request: SyncRequest }[]) {
	const sentence = (names: string[]) => {
		const text = names.join(' and ');
		return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${names.length > 1 ? 'syncs' : 'sync'}`;
	};
	const started = syncs.filter((s) => s.request.started).map((s) => s.name);
	const failed = syncs.filter((s) => !s.request.started).map((s) => s.name);
	if (failed.length === 0) return { ok: true, text: `${ownerName} added. ${sentence(started)} started.` };
	const notStarted = `${sentence(failed).toLowerCase()} could not be started. Use Sync now to try again.`;
	return {
		ok: false,
		text:
			started.length > 0
				? `${ownerName} added. ${sentence(started)} started, but the ${notStarted}`
				: `${ownerName} added, but the ${notStarted}`
	};
}

export const load: PageServerLoad = async (event): Promise<ConnectionsPageData> => {
	const { env, user } = requireAccount(event);
	return connectionsPage(env, event.fetch, user.userId);
};

export const actions: Actions = {
	add: async (event) => {
		const { env, user } = requireAccount(event);
		const value = String((await event.request.formData()).get('source') ?? '');
		const match = /^(character|corporation):(\d+)$/.exec(value);
		const character = match ? await getCharacter(env, Number(match[2])) : undefined;
		if (!match || !character || character.userId !== user.userId) {
			return fail(400, { error: 'Pick one of your characters.' });
		}
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		const kind = match[1] as 'character' | 'corporation';
		const outcome = await addSource(env, event.fetch, user.userId, character, kind);
		if (outcome.joined) return { notice: { ok: true, text: outcome.message } };
		if (!outcome.ok) {
			return fail(
				400,
				outcome.allow ? { error: outcome.message, allow: outcome.allow } : { error: outcome.message }
			);
		}
		const syncs: { name: string; request: SyncRequest }[] = [];
		if (outcome.inventory) {
			syncs.push({
				name: 'inventory',
				request: await requestInventorySync(env, {
					sourceId: outcome.sourceId,
					ownerName: outcome.ownerName,
					dataExpiresAt: null,
					inventoryEnabled: true
				})
			});
		}
		if (outcome.tracking) {
			syncs.push({
				name: 'profit tracking',
				request: await requestTrackingSync(env, {
					sourceId: outcome.sourceId,
					ownerName: outcome.ownerName,
					trackingEnabled: true
				})
			});
		}
		return { notice: addedNotice(outcome.ownerName, syncs) };
	},

	sync: async (event) => {
		const { env, user } = requireAccount(event);
		const sourceId = positiveInt((await event.request.formData()).get('sourceId'));
		const source = sourceId === null ? undefined : await getSource(env, user.userId, sourceId);
		if (!source) return fail(404, { error: NOT_YOURS });
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		return { notice: (await requestInventorySync(env, source)).notice };
	},

	syncTracking: async (event) => {
		const { env, user } = requireAccount(event);
		const sourceId = positiveInt((await event.request.formData()).get('sourceId'));
		const source = sourceId === null ? undefined : await getSource(env, user.userId, sourceId);
		if (!source) return fail(404, { error: NOT_YOURS });
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		return { notice: (await requestTrackingSync(env, source)).notice };
	},

	switch: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const sourceId = positiveInt(form.get('sourceId'));
		const feature = form.get('feature');
		const on = form.get('on');
		if (sourceId === null) return fail(404, { error: NOT_YOURS });
		if ((feature !== 'inventory' && feature !== 'tracking') || (on !== '1' && on !== '0')) {
			return fail(400, { error: 'Pick Inventory or Profit tracking, on or off.' });
		}
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		return outcomeResult(await setSwitch(env, user.userId, sourceId, feature, on === '1'));
	},

	walletDivisions: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const sourceId = positiveInt(form.get('sourceId'));
		if (sourceId === null) return fail(404, { error: NOT_YOURS });
		const divisions = form.getAll('division').map((d) => positiveInt(d));
		if (divisions.some((d) => d === null)) return fail(400, { error: 'Pick wallet divisions 1 to 7.' });
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		return outcomeResult(await saveWalletDivisions(env, user.userId, sourceId, divisions as number[]));
	},

	remove: async (event) => {
		const { env, user } = requireAccount(event);
		const sourceId = positiveInt((await event.request.formData()).get('sourceId'));
		const source = sourceId === null ? undefined : await getSource(env, user.userId, sourceId);
		if (!source || !(await removeSource(env, user.userId, source.sourceId))) {
			return fail(404, { error: NOT_YOURS });
		}
		// Its trades, contracts and jobs leave the ledger with it.
		if (source.trackingEnabled) await requestLedgerRebuild(env, user.userId);
		return { notice: { ok: true, text: 'Connection removed.' } };
	},

	removeReader: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const sourceId = positiveInt(form.get('sourceId'));
		const characterId = positiveInt(form.get('characterId'));
		if (sourceId === null) return fail(404, { error: NOT_YOURS });
		if (characterId === null) return fail(400, { error: 'Pick a character reading this connection.' });
		const outcome = await removeReader(env, user.userId, sourceId, characterId);
		if (!outcome.ok) return fail(outcome.status, { error: outcome.message });
		return { notice: { ok: true, text: outcome.message } };
	}
};
