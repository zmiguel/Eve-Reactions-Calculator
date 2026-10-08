import { characters, getCoreDb, marketHubs, structureLinks, systems } from '@reactions/db';
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { AdminHub } from '$lib/components/admin/HubsAdminTable.svelte';
import { adminCharacterIds } from '$lib/server/session';
import { deleteStructureHub } from '$lib/server/structures';
import { publishMarket } from '$lib/server/updater';
import type { Actions, PageServerLoad } from './$types';

/** Admins only (a character in `ADMIN_CHARACTER_IDS`); everyone else gets a plain 404. */
function requireAdmin({ locals, platform }: Pick<RequestEvent, 'locals' | 'platform'>) {
	if (!locals.user?.isAdmin || !platform) error(404, 'Not Found');
	return { env: platform.env, user: locals.user };
}

export const load: PageServerLoad = async (event) => {
	const db = getCoreDb(requireAdmin(event).env.DB);
	const [rows, links] = await Promise.all([
		db
			.select({
				hubId: marketHubs.hubId,
				name: marketHubs.name,
				kind: marketHubs.kind,
				locationId: marketHubs.locationId,
				visibility: marketHubs.visibility,
				shareStatus: marketHubs.shareStatus,
				enabled: marketHubs.enabled,
				sortOrder: marketHubs.sortOrder,
				systemName: systems.name,
				lastSuccessAt: marketHubs.lastSuccessAt,
				lastError: marketHubs.lastError
			})
			.from(marketHubs)
			.leftJoin(systems, eq(systems.systemId, marketHubs.systemId))
			.orderBy(asc(marketHubs.sortOrder), asc(marketHubs.name)),
		// Contributors are shown by character name only: never tokens, owner hashes or account ids.
		db
			.select({ structureId: structureLinks.structureId, name: characters.name })
			.from(structureLinks)
			.innerJoin(characters, eq(characters.characterId, structureLinks.characterId))
			.orderBy(asc(characters.name))
	]);
	const contributors = new Map<number, string[]>();
	for (const link of links)
		contributors.set(link.structureId, [...(contributors.get(link.structureId) ?? []), link.name]);
	const hubs: AdminHub[] = rows.map(({ locationId, ...hub }) => ({
		...hub,
		visibility: hub.visibility as AdminHub['visibility'],
		shareStatus: hub.shareStatus as AdminHub['shareStatus'],
		contributors: hub.kind === 'structure' ? (contributors.get(locationId) ?? []) : []
	}));
	// Public hubs in their published order first, then private structure hubs by name.
	hubs.sort((a, b) => Number(b.visibility === 'public') - Number(a.visibility === 'public'));
	return { now: Date.now(), hubs };
};

type HubRow = typeof marketHubs.$inferSelect;

/**
 * Reads the posted `hubId`, runs `change` on that hub and republishes `market:v1` when `publish` says so
 * for the hub as it was before the change.
 */
async function hubAction(
	event: RequestEvent,
	change: (ctx: { env: Env; hub: HubRow; adminCharacterId: number }) => Promise<string | { error: string }>,
	publish: (hub: HubRow) => boolean = () => true
) {
	const { env, user } = requireAdmin(event);
	const hubId = String((await event.request.formData()).get('hubId') ?? '');
	const [hub] = await getCoreDb(env.DB).select().from(marketHubs).where(eq(marketHubs.hubId, hubId));
	if (!hub) return fail(404, { notice: { ok: false, text: 'Unknown hub.' } });
	const admins = adminCharacterIds(env);
	const adminCharacterId =
		user.characterId !== null && admins.has(user.characterId)
			? user.characterId
			: user.characters.find((c) => admins.has(c.characterId))!.characterId;
	const result = await change({ env, hub, adminCharacterId });
	if (typeof result !== 'string') return fail(400, { notice: { ok: false, text: result.error } });
	if (!publish(hub) || (await publishMarket(env))) return { notice: { ok: true, text: result } };
	return {
		notice: {
			ok: false,
			text: `${result} The updater did not answer: public prices show the change after the next price refresh.`
		}
	};
}

const notPublic = { error: 'Only public hubs can be enabled, disabled or moved.' };

/** Moves a public hub one place up or down and renumbers all public hubs 1…n. */
async function move(env: Env, hub: HubRow, by: -1 | 1): Promise<string | { error: string }> {
	if (hub.visibility !== 'public') return notPublic;
	const db = getCoreDb(env.DB);
	const order = await db
		.select({ hubId: marketHubs.hubId, sortOrder: marketHubs.sortOrder })
		.from(marketHubs)
		.where(eq(marketHubs.visibility, 'public'))
		.orderBy(asc(marketHubs.sortOrder), asc(marketHubs.hubId));
	const from = order.findIndex((h) => h.hubId === hub.hubId);
	const to = from + by;
	if (to < 0 || to >= order.length) return `${hub.name} is already ${by < 0 ? 'first' : 'last'}.`;
	[order[from], order[to]] = [order[to]!, order[from]!];
	const updates = order
		.map((h, i) => ({ ...h, next: i + 1 }))
		.filter((h) => h.sortOrder !== h.next)
		.map((h) => db.update(marketHubs).set({ sortOrder: h.next }).where(eq(marketHubs.hubId, h.hubId)));
	if (updates.length) await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
	return `${hub.name} moved ${by < 0 ? 'up' : 'down'}.`;
}

async function setEnabled(env: Env, hub: HubRow, enabled: boolean): Promise<string | { error: string }> {
	if (hub.visibility !== 'public') return notPublic;
	await getCoreDb(env.DB).update(marketHubs).set({ enabled }).where(eq(marketHubs.hubId, hub.hubId));
	return `${hub.name} ${enabled ? 'enabled' : 'disabled'}.`;
}

export const actions: Actions = {
	enable: (event) => hubAction(event, ({ env, hub }) => setEnabled(env, hub, true)),
	disable: (event) => hubAction(event, ({ env, hub }) => setEnabled(env, hub, false)),
	up: (event) => hubAction(event, ({ env, hub }) => move(env, hub, -1)),
	down: (event) => hubAction(event, ({ env, hub }) => move(env, hub, 1)),

	approve: (event) =>
		hubAction(event, async ({ env, hub, adminCharacterId }) => {
			if (hub.kind !== 'structure' || hub.shareStatus !== 'pending') {
				return { error: 'Only structure markets waiting for review can be approved.' };
			}
			await getCoreDb(env.DB)
				.update(marketHubs)
				.set({
					visibility: 'public',
					shareStatus: 'approved',
					shareReviewedBy: adminCharacterId,
					shareReviewedAt: Date.now()
				})
				.where(eq(marketHubs.hubId, hub.hubId));
			return `${hub.name} is public.`;
		}),

	reject: (event) =>
		hubAction(
			event,
			async ({ env, hub, adminCharacterId }) => {
				if (hub.kind !== 'structure' || hub.shareStatus !== 'pending') {
					return { error: 'Only structure markets waiting for review can be rejected.' };
				}
				await getCoreDb(env.DB)
					.update(marketHubs)
					.set({ shareStatus: 'rejected', shareReviewedBy: adminCharacterId, shareReviewedAt: Date.now() })
					.where(eq(marketHubs.hubId, hub.hubId));
				return `${hub.name} rejected; it stays private for its users.`;
			},
			() => false
		),

	revoke: (event) =>
		hubAction(event, async ({ env, hub, adminCharacterId }) => {
			if (hub.kind !== 'structure') return { error: 'NPC hubs cannot be revoked.' };
			if (hub.visibility !== 'public') return { error: `${hub.name} is not public.` };
			await getCoreDb(env.DB)
				.update(marketHubs)
				.set({
					visibility: 'private',
					shareStatus: 'rejected',
					shareReviewedBy: adminCharacterId,
					shareReviewedAt: Date.now()
				})
				.where(eq(marketHubs.hubId, hub.hubId));
			return `${hub.name} is private again.`;
		}),

	delete: (event) =>
		hubAction(
			event,
			async ({ env, hub }) => {
				if (hub.kind !== 'structure') return { error: 'NPC hubs cannot be deleted.' };
				await deleteStructureHub(env, hub.locationId);
				return `${hub.name} deleted.`;
			},
			(hub) => hub.visibility === 'public'
		)
};
