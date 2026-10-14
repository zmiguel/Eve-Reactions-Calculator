import { describe, expect, it } from 'vitest';
import {
	ALL_ESI_SCOPES,
	ESI_FEATURES,
	GRANTABLE_FEATURES,
	STRUCTURE_SCOPES,
	formatScopes,
	grantedFeatures,
	hasFeature,
	isEsiFeature,
	isGrantableFeature,
	missingScopes,
	parseScopes,
	scopesForFeature
} from '../src/index.ts';

const WALLET = 'esi-wallet.read_character_wallet.v1';
const TRACKING = [
	'esi-characters.read_blueprints.v1',
	'esi-contracts.read_character_contracts.v1',
	'esi-industry.read_character_jobs.v1',
	'esi-markets.read_character_orders.v1',
	'esi-universe.read_structures.v1',
	WALLET
];
const CORP_TRACKING = [
	'esi-contracts.read_corporation_contracts.v1',
	'esi-corporations.read_blueprints.v1',
	'esi-corporations.read_divisions.v1',
	'esi-industry.read_corporation_jobs.v1',
	'esi-markets.read_corporation_orders.v1',
	'esi-universe.read_structures.v1',
	'esi-wallet.read_corporation_wallets.v1'
];

describe('scope registry', () => {
	it('maps features to scope sets; login asks for nothing', () => {
		expect(ESI_FEATURES.login).toEqual([]);
		expect(ESI_FEATURES.structures).toEqual(STRUCTURE_SCOPES);
		expect(ESI_FEATURES.assets).toEqual([
			'esi-assets.read_assets.v1',
			'esi-industry.read_character_jobs.v1',
			'esi-universe.read_structures.v1'
		]);
		expect(ESI_FEATURES.corp_assets).toEqual([
			'esi-assets.read_corporation_assets.v1',
			'esi-corporations.read_divisions.v1',
			'esi-industry.read_corporation_jobs.v1',
			'esi-universe.read_structures.v1'
		]);
		expect(ESI_FEATURES.tracking).toEqual(TRACKING);
		expect(ESI_FEATURES.corp_tracking).toEqual(CORP_TRACKING);
		expect(GRANTABLE_FEATURES).toEqual(['structures', 'assets', 'corp_assets', 'tracking', 'corp_tracking']);
	});

	it('lists every scope once for the SSO application', () => {
		expect(ALL_ESI_SCOPES).toEqual([
			'esi-assets.read_assets.v1',
			'esi-assets.read_corporation_assets.v1',
			'esi-characters.read_blueprints.v1',
			'esi-contracts.read_character_contracts.v1',
			'esi-contracts.read_corporation_contracts.v1',
			'esi-corporations.read_blueprints.v1',
			'esi-corporations.read_divisions.v1',
			'esi-industry.read_character_jobs.v1',
			'esi-industry.read_corporation_jobs.v1',
			'esi-markets.read_character_orders.v1',
			'esi-markets.read_corporation_orders.v1',
			'esi-markets.structure_markets.v1',
			'esi-search.search_structures.v1',
			'esi-universe.read_structures.v1',
			WALLET,
			'esi-wallet.read_corporation_wallets.v1'
		]);
		expect(new Set(ALL_ESI_SCOPES).size).toBe(16);
	});

	it('recognises feature names', () => {
		expect(isEsiFeature('structures')).toBe(true);
		expect(isEsiFeature('login')).toBe(true);
		expect(isEsiFeature('toString')).toBe(false);
		expect(isEsiFeature(undefined)).toBe(false);
		expect(isGrantableFeature('login')).toBe(false);
		expect(isGrantableFeature('tracking')).toBe(true);
		expect(isEsiFeature('wallet')).toBe(false);
		expect(isEsiFeature('industry')).toBe(false);
	});
});

describe('scope helpers', () => {
	it('parses space-separated scopes, dropping blanks and duplicates', () => {
		expect(parseScopes('')).toEqual([]);
		expect(parseScopes(null)).toEqual([]);
		expect(parseScopes(`  ${WALLET}  ${WALLET} b `)).toEqual([WALLET, 'b']);
		expect(formatScopes(['b', 'a', 'b'])).toBe('a b');
	});

	it('has a feature only when every scope of it is granted', () => {
		expect(hasFeature('', 'login')).toBe(true);
		expect(hasFeature('', 'structures')).toBe(false);
		expect(hasFeature(STRUCTURE_SCOPES.slice(0, 2).join(' '), 'structures')).toBe(false);
		expect(hasFeature([...STRUCTURE_SCOPES, WALLET].join(' '), 'structures')).toBe(true);
		expect(hasFeature(TRACKING, 'tracking')).toBe(true);
		expect(hasFeature(TRACKING.slice(1), 'tracking')).toBe(false);
		expect(hasFeature(CORP_TRACKING, 'corp_tracking')).toBe(true);
		// A tracking grant from before the blueprint scopes no longer covers the feature.
		expect(
			hasFeature(
				CORP_TRACKING.filter((s) => !s.includes('blueprints')),
				'corp_tracking'
			)
		).toBe(false);
		expect(grantedFeatures([...STRUCTURE_SCOPES, ...TRACKING].join(' '))).toEqual(['structures', 'tracking']);
		expect(grantedFeatures(null)).toEqual([]);
		expect(hasFeature(['esi-assets.read_assets.v1', 'esi-universe.read_structures.v1'], 'assets')).toBe(
			false
		);
		expect(
			hasFeature(
				[
					'esi-assets.read_assets.v1',
					'esi-industry.read_character_jobs.v1',
					'esi-universe.read_structures.v1'
				],
				'assets'
			)
		).toBe(true);
		const corpScopes = [
			'esi-assets.read_corporation_assets.v1',
			'esi-corporations.read_divisions.v1',
			'esi-industry.read_corporation_jobs.v1',
			'esi-universe.read_structures.v1'
		];
		expect(hasFeature(corpScopes.slice(0, 3), 'corp_assets')).toBe(false);
		expect(hasFeature(corpScopes, 'corp_assets')).toBe(true);
		expect(hasFeature(corpScopes, 'assets')).toBe(false);
	});

	it('unions the requested feature with the scopes the character already has', () => {
		expect(scopesForFeature('tracking')).toEqual([...TRACKING].sort());
		expect(scopesForFeature('tracking', STRUCTURE_SCOPES.join(' '))).toEqual(
			[...new Set([...STRUCTURE_SCOPES, ...TRACKING])].sort()
		);
		// Re-requesting a feature the character has keeps the set unchanged.
		expect(scopesForFeature('structures', [...STRUCTURE_SCOPES, WALLET])).toEqual(
			[...STRUCTURE_SCOPES, WALLET].sort()
		);
		expect(scopesForFeature('login', WALLET)).toEqual([WALLET]);
		expect(scopesForFeature('corp_assets', STRUCTURE_SCOPES)).toEqual(
			[
				...STRUCTURE_SCOPES,
				'esi-assets.read_corporation_assets.v1',
				'esi-corporations.read_divisions.v1',
				'esi-industry.read_corporation_jobs.v1'
			].sort()
		);
	});

	it('reports the scopes a new grant would drop', () => {
		expect(missingScopes(`${WALLET} x`, [WALLET])).toEqual(['x']);
		expect(missingScopes(WALLET, `${WALLET} y`)).toEqual([]);
		expect(missingScopes('', [])).toEqual([]);
	});
});
