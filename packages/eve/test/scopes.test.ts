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

describe('scope registry', () => {
	it('maps features to scope sets; login asks for nothing', () => {
		expect(ESI_FEATURES.login).toEqual([]);
		expect(ESI_FEATURES.structures).toEqual(STRUCTURE_SCOPES);
		expect(ESI_FEATURES.wallet).toEqual([WALLET]);
		expect(ESI_FEATURES.assets).toEqual(['esi-assets.read_assets.v1']);
		expect(ESI_FEATURES.industry).toEqual(['esi-industry.read_character_jobs.v1']);
		expect(GRANTABLE_FEATURES).toEqual(['structures', 'wallet', 'assets', 'industry']);
	});

	it('lists every scope once for the SSO application', () => {
		expect(ALL_ESI_SCOPES).toEqual([
			'esi-assets.read_assets.v1',
			'esi-industry.read_character_jobs.v1',
			'esi-markets.structure_markets.v1',
			'esi-search.search_structures.v1',
			'esi-universe.read_structures.v1',
			WALLET
		]);
	});

	it('recognises feature names', () => {
		expect(isEsiFeature('structures')).toBe(true);
		expect(isEsiFeature('login')).toBe(true);
		expect(isEsiFeature('toString')).toBe(false);
		expect(isEsiFeature(undefined)).toBe(false);
		expect(isGrantableFeature('login')).toBe(false);
		expect(isGrantableFeature('wallet')).toBe(true);
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
		expect(hasFeature([WALLET], 'wallet')).toBe(true);
		expect(grantedFeatures([...STRUCTURE_SCOPES, WALLET].join(' '))).toEqual(['structures', 'wallet']);
		expect(grantedFeatures(null)).toEqual([]);
	});

	it('unions the requested feature with the scopes the character already has', () => {
		expect(scopesForFeature('wallet')).toEqual([WALLET]);
		expect(scopesForFeature('wallet', STRUCTURE_SCOPES.join(' '))).toEqual(
			[...STRUCTURE_SCOPES, WALLET].sort()
		);
		// Re-requesting a feature the character has keeps the set unchanged.
		expect(scopesForFeature('structures', [...STRUCTURE_SCOPES, WALLET])).toEqual(
			[...STRUCTURE_SCOPES, WALLET].sort()
		);
		expect(scopesForFeature('login', WALLET)).toEqual([WALLET]);
	});

	it('reports the scopes a new grant would drop', () => {
		expect(missingScopes(`${WALLET} x`, [WALLET])).toEqual(['x']);
		expect(missingScopes(WALLET, `${WALLET} y`)).toEqual([]);
		expect(missingScopes('', [])).toEqual([]);
	});
});
