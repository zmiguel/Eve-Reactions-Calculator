import { getCoreDb, inventorySources, structureLinks } from '@reactions/db';
import {
	ESI_FEATURES,
	GRANTABLE_FEATURES,
	hasFeature,
	parseScopes,
	type GrantableFeature
} from '@reactions/eve';
import { and, eq } from 'drizzle-orm';
import { SWITCH_FEATURES, canRead, poolsOf, removeReader, type ConnectionSwitch } from '../inventory.ts';
import { requestLedgerRebuild } from '../ledger-rebuild.ts';
import { releaseStructureHubs } from '../structures.ts';
import { listCharacters } from './accounts.ts';

/** Scopes only one feature asks for: holding one means that feature was granted. */
const EXCLUSIVE_SCOPES: Partial<Record<GrantableFeature, readonly string[]>> = Object.fromEntries(
	GRANTABLE_FEATURES.map((f) => [
		f,
		(ESI_FEATURES[f] as readonly string[]).filter((s) =>
			GRANTABLE_FEATURES.every(
				(other) => other === f || !(ESI_FEATURES[other] as readonly string[]).includes(s)
			)
		)
	])
);

/**
 * Features a character holds: every scope granted (`grantedFeatures`), or at least one scope only that
 * feature asks for, so a grant from before a feature gained a scope still counts (and is pre-checked,
 * so saving the permissions again adds the new scope).
 */
export function heldFeatures(scopes: string | readonly string[] | null | undefined): GrantableFeature[] {
	const have = new Set(parseScopes(scopes));
	return GRANTABLE_FEATURES.filter(
		(f) => hasFeature(scopes, f) || (EXCLUSIVE_SCOPES[f] ?? []).some((s) => have.has(s))
	);
}

/**
 * Brings the account's data in line with character `characterId` losing features (`before` minus
 * `after`); call it after the character's new scopes are stored.
 * - `assets`: Inventory off on the character's personal connection.
 * - `tracking`: Profit tracking off on it.
 * - `corp_assets` / `corp_tracking`: on every corporation connection whose reader pool includes the
 *   character, a switch whose feature no pool member can read any more goes off. Without either
 *   corporation feature the character leaves the pool (handing the preferred reader over, `removeReader`);
 *   as the only member it stays and both switches go off (the connection and its data are kept).
 * - `structures`: the character's structure links are removed and their hubs cleaned up.
 * A tracking switch going off asks for a ledger rebuild.
 */
export async function applyFeatureChange(
	env: Env,
	userId: string,
	characterId: number,
	before: readonly GrantableFeature[],
	after: readonly GrantableFeature[]
): Promise<void> {
	const removed = new Set(before.filter((f) => !after.includes(f)));
	if (removed.size === 0) return;
	const db = getCoreDb(env.DB);
	let trackingOff = false;

	const personal = and(
		eq(inventorySources.userId, userId),
		eq(inventorySources.kind, 'character'),
		eq(inventorySources.characterId, characterId)
	);
	if (removed.has('assets')) {
		await db.update(inventorySources).set({ inventoryEnabled: false }).where(personal);
	}
	if (removed.has('tracking')) {
		const off = await db
			.update(inventorySources)
			.set({ trackingEnabled: false })
			.where(and(personal, eq(inventorySources.trackingEnabled, true)))
			.returning({ sourceId: inventorySources.sourceId });
		if (off.length) trackingOff = true;
	}

	if (removed.has('corp_assets') || removed.has('corp_tracking')) {
		const { results: sources } = await env.DB.prepare(
			`SELECT s.source_id AS sourceId, s.tracking_enabled AS trackingEnabled
			FROM inventory_sources s JOIN inventory_source_readers r ON r.source_id = s.source_id
			WHERE s.user_id = ? AND s.kind = 'corporation' AND r.character_id = ?`
		)
			.bind(userId, characterId)
			.all<{ sourceId: number; trackingEnabled: number }>();
		if (sources.length) {
			const [characters, pools] = await Promise.all([
				listCharacters(env, userId),
				poolsOf(
					env,
					userId,
					sources.map((s) => s.sourceId)
				)
			]);
			const leaves = !after.includes('corp_assets') && !after.includes('corp_tracking');
			for (const source of sources) {
				const members = characters.filter((c) =>
					pools.some((p) => p.sourceId === source.sourceId && p.characterId === c.characterId)
				);
				const off = new Set<ConnectionSwitch>();
				for (const which of ['inventory', 'tracking'] as const) {
					const feature = SWITCH_FEATURES[which].corporation;
					if (removed.has(feature) && !members.some((c) => canRead(c, feature))) off.add(which);
				}
				if (leaves) {
					if (members.length > 1) await removeReader(env, userId, source.sourceId, characterId);
					else off.add('inventory').add('tracking');
				}
				if (off.size === 0) continue;
				await db
					.update(inventorySources)
					.set({
						...(off.has('inventory') ? { inventoryEnabled: false } : {}),
						...(off.has('tracking') ? { trackingEnabled: false } : {})
					})
					.where(and(eq(inventorySources.sourceId, source.sourceId), eq(inventorySources.userId, userId)));
				if (off.has('tracking') && source.trackingEnabled) trackingOff = true;
			}
		}
	}

	if (removed.has('structures')) {
		const links = await db
			.delete(structureLinks)
			.where(and(eq(structureLinks.userId, userId), eq(structureLinks.characterId, characterId)))
			.returning({ structureId: structureLinks.structureId });
		await releaseStructureHubs(
			env,
			links.map((l) => l.structureId)
		);
	}

	if (trackingOff) await requestLedgerRebuild(env, userId);
}
