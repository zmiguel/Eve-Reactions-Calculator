// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../test/storage';
import {
	IDENTITY_STORAGE_KEY,
	applyIdentity,
	syncAnalyticsIdentity,
	type AnalyticsIdentity,
	type AnalyticsTraits,
	type RybbitApi
} from './analytics';

/** Live tracker as the Rybbit script exposes it after init: the user id persists in localStorage. */
function tracker(stored: string | null = null) {
	let userId = stored;
	const api = {
		identify: vi.fn((id: string, _traits?: Record<string, unknown>) => {
			userId = id;
		}),
		clearUserId: vi.fn(() => {
			userId = null;
		}),
		getUserId: () => userId,
		onReady: (callback: (r: RybbitApi) => void) => callback(api)
	};
	return api;
}

const traits: AnalyticsTraits = {
	username: 'Alpha Pilot',
	name: 'Alpha Pilot',
	main_character_id: 90000001,
	corporation: 'Reaction Corp',
	alliance: 'none',
	is_admin: false,
	characters: 1,
	account_created: '2026-10-06',
	features: 'none',
	structure: 'tatara',
	security: 'lowsec',
	input_hub: 'jita',
	output_hub: 'jita',
	per_reactor: false,
	slots: 'single',
	unrefined: 'never',
	custom_settings: false
};
const alpha: AnalyticsIdentity = { userId: 'u1', traits };

describe('applyIdentity', () => {
	let storage: MemoryStorage;
	beforeEach(() => {
		storage = new MemoryStorage();
	});

	it('identifies a logged-in visitor with every trait', () => {
		const rybbit = tracker();
		applyIdentity(rybbit, alpha, storage);
		expect(rybbit.identify).toHaveBeenCalledExactlyOnceWith('u1', traits);
	});

	it('does not repeat the identify request on later page loads', () => {
		const rybbit = tracker();
		applyIdentity(rybbit, alpha, storage);
		applyIdentity(rybbit, alpha, storage);
		expect(rybbit.identify).toHaveBeenCalledTimes(1);
	});

	it('identifies again when a trait changes or another account logs in', () => {
		const rybbit = tracker();
		applyIdentity(rybbit, alpha, storage);
		applyIdentity(rybbit, { userId: 'u1', traits: { ...traits, alliance: 'Moon Alliance' } }, storage);
		applyIdentity(rybbit, { userId: 'u1', traits: { ...traits, alliance: 'Moon Alliance' } }, storage);
		applyIdentity(rybbit, { userId: 'u2', traits: { ...traits, username: 'Gamma', name: 'Gamma' } }, storage);
		expect(rybbit.identify.mock.calls.map((c) => c[0])).toEqual(['u1', 'u1', 'u2']);
		expect(rybbit.identify.mock.calls[1][1]).toMatchObject({ alliance: 'Moon Alliance' });
	});

	it('identifies when the tracker lost its id even though this browser sent it before', () => {
		const rybbit = tracker();
		storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(alpha));
		applyIdentity(rybbit, alpha, storage);
		expect(rybbit.identify).toHaveBeenCalledTimes(1);
	});

	it('clears the stored id after logout, and only when one is stored', () => {
		const identified = tracker('u1');
		storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(alpha));
		applyIdentity(identified, null, storage);
		expect(identified.clearUserId).toHaveBeenCalledTimes(1);
		expect(storage.getItem(IDENTITY_STORAGE_KEY)).toBeNull();

		const anonymous = tracker();
		applyIdentity(anonymous, null, storage);
		expect(anonymous.clearUserId).not.toHaveBeenCalled();
	});

	it('identifies on every load when storage is unavailable', () => {
		const rybbit = tracker('u1');
		applyIdentity(rybbit, alpha, null);
		applyIdentity(rybbit, alpha, null);
		expect(rybbit.identify).toHaveBeenCalledTimes(2);
	});
});

describe('syncAnalyticsIdentity', () => {
	afterEach(() => {
		delete window.rybbit;
		document.head.innerHTML = '';
	});

	it('waits for the async tracking script when it has not run yet', () => {
		const script = document.createElement('script');
		script.dataset.siteId = '1';
		script.setAttribute('src', 'https://ry.zm.gl/api/script.js');
		document.head.appendChild(script);

		syncAnalyticsIdentity(alpha);
		const rybbit = tracker();
		window.rybbit = rybbit;
		expect(rybbit.identify).not.toHaveBeenCalled();
		script.dispatchEvent(new Event('load'));
		expect(rybbit.identify).toHaveBeenCalledExactlyOnceWith('u1', expect.anything());
	});

	it('uses the tracker at once when it is already there', () => {
		const rybbit = tracker();
		window.rybbit = rybbit;
		syncAnalyticsIdentity(alpha);
		expect(rybbit.identify).toHaveBeenCalledTimes(1);
	});
});
