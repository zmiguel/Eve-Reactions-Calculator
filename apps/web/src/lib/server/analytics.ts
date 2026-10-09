import { REACTORS, isDefaultSettings, type Settings } from '@reactions/engine';
import type { AnalyticsIdentity } from '$lib/analytics';
import { getSystems } from './profiles.ts';
import type { AccountFacts, SessionUser } from './session.ts';

/** Security band per system id; bands only change with an SDE import, so the memo never expires. */
const bandMemo = new Map<number, string>();

async function securityBands(env: Pick<Env, 'DB'> | undefined, ids: number[]): Promise<Map<number, string>> {
	const missing = [...new Set(ids)].filter((id) => !bandMemo.has(id));
	if (env && missing.length > 0)
		for (const [id, system] of await getSystems(env, missing)) bandMemo.set(id, system.securityBand);
	return new Map(ids.flatMap((id) => (bandMemo.has(id) ? [[id, bandMemo.get(id)!] as const] : [])));
}

/** The one value every profile in use shares, `mixed` otherwise. */
function shared(values: string[]): string {
	return values.every((v) => v === values[0]) ? values[0] : 'mixed';
}

/** NPC hubs by id; structure markets only as `structure` (their names and ids stay out of analytics). */
const hubTrait = (hubId: string) => (hubId.startsWith('structure-') ? 'structure' : hubId);

/**
 * Rybbit identity of a logged-in visitor (null when anonymous): account id plus traits about the account
 * and its settings. Only the security band needs a lookup (memoised per isolate).
 */
export async function analyticsIdentity(
	env: Pick<Env, 'DB'> | undefined,
	user: SessionUser | null,
	account: AccountFacts | null,
	settings: Settings
): Promise<AnalyticsIdentity | null> {
	const main = user?.characters[0];
	if (!user || !account || !main) return null;
	const profiles = settings.mode === 'shared' ? [settings.shared] : REACTORS.map((r) => settings.reactors[r]);
	const bands = await securityBands(
		env,
		profiles.map((p) => p.systemId)
	);
	return {
		userId: user.userId,
		traits: {
			username: main.name,
			name: main.name,
			main_character_id: main.characterId,
			corporation: account.corporation ?? 'unknown',
			alliance: account.corporation === null ? 'unknown' : (account.alliance ?? 'none'),
			is_admin: user.isAdmin,
			characters: user.characters.length,
			account_created: new Date(account.createdAt).toISOString().slice(0, 10),
			features: account.features.join(',') || 'none',
			structure: shared(profiles.map((p) => p.structure)),
			security: shared(profiles.map((p) => bands.get(p.systemId) ?? 'unknown')),
			input_hub: shared(profiles.map((p) => hubTrait(p.market.inputHub))),
			output_hub: shared(profiles.map((p) => hubTrait(p.market.outputHub))),
			per_reactor: settings.mode === 'per_reactor',
			slots: settings.slotAllocation,
			unrefined: settings.unrefinedInChains,
			custom_settings: !isDefaultSettings(settings)
		}
	};
}
