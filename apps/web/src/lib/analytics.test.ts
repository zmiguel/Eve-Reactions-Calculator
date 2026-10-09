// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../test/storage';
import { IDENTITY_STORAGE_KEY, applyIdentity, syncAnalyticsIdentity, type RybbitApi } from './analytics';

/** Live tracker as the Rybbit script exposes it after init: the user id persists in localStorage. */
function tracker(stored: string | null = null) {
	let userId = stored;
	const api = {
		identify: vi.fn((id: string) => {
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

const alpha = { userId: 'u1', username: 'Alpha Pilot' };

describe('applyIdentity', () => {
	let storage: MemoryStorage;
	beforeEach(() => {
		storage = new MemoryStorage();
	});

	it('identifies a logged-in visitor with the main character as username', () => {
		const rybbit = tracker();
		applyIdentity(rybbit, alpha, storage);
		expect(rybbit.identify).toHaveBeenCalledExactlyOnceWith('u1', {
			username: 'Alpha Pilot',
			name: 'Alpha Pilot'
		});
	});

	it('does not repeat the identify request on later page loads', () => {
		const rybbit = tracker();
		applyIdentity(rybbit, alpha, storage);
		applyIdentity(rybbit, alpha, storage);
		expect(rybbit.identify).toHaveBeenCalledTimes(1);
	});

	it('identifies again when the main character changes or another account logs in', () => {
		const rybbit = tracker();
		applyIdentity(rybbit, alpha, storage);
		applyIdentity(rybbit, { userId: 'u1', username: 'Beta Pilot' }, storage);
		applyIdentity(rybbit, { userId: 'u2', username: 'Gamma' }, storage);
		expect(rybbit.identify.mock.calls.map((c) => c[0])).toEqual(['u1', 'u1', 'u2']);
		expect(rybbit.identify).toHaveBeenLastCalledWith('u2', { username: 'Gamma', name: 'Gamma' });
	});

	it('identifies when the tracker lost its id even though this browser sent it before', () => {
		const rybbit = tracker();
		storage.setItem(IDENTITY_STORAGE_KEY, 'u1\nAlpha Pilot');
		applyIdentity(rybbit, alpha, storage);
		expect(rybbit.identify).toHaveBeenCalledTimes(1);
	});

	it('clears the stored id after logout, and only when one is stored', () => {
		const identified = tracker('u1');
		storage.setItem(IDENTITY_STORAGE_KEY, 'u1\nAlpha Pilot');
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
