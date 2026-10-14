import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FacilityView } from '$lib/account/facilities';
import type { TrackingSettingsPageData } from '$lib/server/tracking-settings';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Page from './+page.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);

const facility = (facilityId: string, overrides: Partial<FacilityView> = {}): FacilityView => ({
	facilityId,
	name: null,
	systemName: null,
	band: null,
	jobs: { reaction: 1, manufacturing: 0 },
	detectedStructure: null,
	detectedRigs: null,
	structures: [{ typeId: 35835, name: 'Athanor', groupId: 1406, rigSize: 2, rigSlots: 3 }],
	setting: { structureTypeId: null, rigs: null },
	needs: { structure: true, rigs: false },
	bonus: [],
	reactionProfile: true,
	reactorDefault: null,
	...overrides
});

function data(overrides: Partial<TrackingSettingsPageData> = {}) {
	const page: TrackingSettingsPageData = {
		connections: [{ sourceId: 1, kind: 'character', ownerName: 'Alpha', trackingSyncedAt: NOW }],
		rebuiltAt: NOW,
		dirty: false,
		reviewCount: 3,
		hubs: [
			{ hubId: 'jita', name: 'Jita 4-4', private: false },
			{ hubId: 'amarr', name: 'Amarr', private: false },
			{ hubId: 'structure-1', name: 'My Market', private: true }
		],
		settings: {
			contractRule: { hubId: 'structure-1', basis: 'sell', expectedPct: 90, tolerancePct: 7 },
			facilities: { '102': { structureTypeId: 35835 } },
			blueprintMe: { '3001': 8 },
			manufacturingUse: 'zero',
			defaultPeriod: '90'
		},
		facilities: {
			list: [
				facility('101', {
					name: 'Moon Factory',
					systemName: 'Ignoitton',
					band: 'lowsec',
					jobs: { reaction: 2, manufacturing: 0 },
					detectedStructure: { typeId: 35836, name: 'Tatara' },
					detectedRigs: { names: ['Standup L-Set Reactor Efficiency II'], others: 0, readAt: NOW },
					needs: { structure: false, rigs: false },
					bonus: [
						{
							activity: 'reaction',
							label: 'Composite Reactions',
							reduction: 0.024,
							fromReactorSettings: false
						}
					],
					reactionProfile: false
				}),
				facility('102', {
					setting: { structureTypeId: 35835, rigs: null },
					needs: { structure: false, rigs: true }
				}),
				facility('103')
			],
			rigs: [],
			industryAvailable: true,
			needsInput: 2
		},
		blueprints: [
			{ blueprintTypeId: '3001', name: 'Widget Blueprint', jobs: 2 },
			{ blueprintTypeId: '3002', name: 'Gadget Blueprint', jobs: 1 }
		],
		janice: { linked: 4, appraised: 3 },
		...overrides
	};
	return { user: { characterId: 90000001, name: 'Alpha', isAdmin: false }, ...page };
}

const renderPage = (pageData = data(), form: unknown = null) =>
	render(Page, { props: { data: pageData, form, params: {} } as never });

const select = (container: Element, name: string) =>
	[...container.querySelectorAll('select')].find((s) => s.name === name)!;

beforeEach(() => setPage({ url: 'https://reactions.coalition.space/account/tracking' }));
afterEach(() => {
	resetPage();
	document.head.innerHTML = '';
});

describe('/account/tracking page', () => {
	it('preselects the stored contract rule and facility settings', () => {
		const { container } = renderPage();
		expect(select(container, 'hubId').value).toBe('structure-1');
		expect(select(container, 'basis').value).toBe('sell');
		expect((container.querySelector('input[name="expectedPct"]') as HTMLInputElement).value).toBe('90');
		expect((container.querySelector('input[name="tolerancePct"]') as HTMLInputElement).value).toBe('7');
		// Detected by EVE: no select.
		expect(select(container, 'structure-101')).toBeUndefined();
		expect(select(container, 'structure-102').value).toBe('35835');
		expect(select(container, 'structure-103').value).toBe('');
	});

	it('Facilities: one form, the count of facilities needing input and their marks', () => {
		const { container } = renderPage();
		const section = container.querySelector('[data-facilities]')!;
		expect(section.querySelector('h2')?.textContent).toBe('Facilities');
		expect(section.querySelector('[data-needs-count]')?.textContent?.trim()).toBe(
			'2 facilities need your input.'
		);
		expect(
			[...section.querySelectorAll('[data-facility]')].map((li) => [
				li.getAttribute('data-facility'),
				li.querySelector('[data-needs-input]') !== null
			])
		).toEqual([
			['101', false],
			['102', true],
			['103', true]
		]);
		expect(section.querySelector('[data-no-industry]')).toBeNull();
		const posted = new FormData(section.querySelector('form[data-form="facilities"]') as HTMLFormElement);
		expect([...posted.keys()]).toEqual(['structure-102', 'rigsFor-102', 'structure-103']);
		// The manufacturing form has no facilities any more.
		expect(container.querySelector('form[data-form="manufacturing"] [data-facility]')).toBeNull();
	});

	it('Facilities without rig data: says so, structure selects only', () => {
		const base = data();
		const { container } = renderPage(
			data({ facilities: { ...base.facilities, industryAvailable: false, needsInput: 1 } })
		);
		expect(container.querySelector('[data-no-industry]')).not.toBeNull();
		expect(container.querySelector('[data-needs-count]')?.textContent?.trim()).toBe(
			'1 facility needs your input.'
		);
		expect(container.querySelector('[data-rig-select], input[name^="rigsFor-"]')).toBeNull();
		expect(select(container, 'structure-102')).toBeDefined();
	});

	it('without tracked connections or jobs: empty states and no facilities form', () => {
		const { container } = renderPage(
			data({
				connections: [],
				facilities: { list: [], rigs: [], industryAvailable: true, needsInput: 0 },
				reviewCount: 0
			})
		);
		expect(container.querySelector('[data-empty] a[href="/account/connections"]')).not.toBeNull();
		expect(container.querySelector('[data-connections]')).toBeNull();
		expect(container.querySelector('form[data-form="facilities"]')).toBeNull();
		expect(container.querySelector('[data-no-facilities]')).not.toBeNull();
		expect(container.querySelector('[data-review]')).toBeNull();
	});

	it('shows the review count as a number linking to the ledger rows needing review', () => {
		const { container } = renderPage();
		expect(container.querySelector('[data-review]')?.textContent).toBe('3');
		expect(container.querySelector('[data-review]')?.closest('a')?.getAttribute('href')).toBe(
			'/profits/ledger?review=1'
		);
	});

	it('shows the notice only on the form that was saved, inside that form next to its Save button', () => {
		const { container } = renderPage(data(), { form: 'facilities', notice: 'Saved. Results recalculated.' });
		const notices = [...container.querySelectorAll('[data-notice]')];
		expect(notices).toHaveLength(1);
		expect(notices[0].getAttribute('role')).toBe('status');
		expect(notices[0].closest('form')?.dataset.form).toBe('facilities');
		expect(notices[0].parentElement?.querySelector('button[type="submit"]')).not.toBeNull();
		expect(notices[0].getAttribute('data-notice')).toBe('ok');
	});

	it('a rejected save is an alert inside the form that was saved', () => {
		const { container } = renderPage(data(), { form: 'contracts', error: 'Rejected.' });
		const notices = [...container.querySelectorAll('[data-notice]')];
		expect(notices).toHaveLength(1);
		expect(notices[0].getAttribute('role')).toBe('alert');
		expect(notices[0].getAttribute('data-notice')).toBe('error');
		expect(notices[0].closest('form')?.dataset.form).toBe('contracts');
	});

	it('Manufacturing: the stored use and blueprint ME (default 10) preselected', () => {
		const { container } = renderPage();
		const form = container.querySelector('form[data-form="manufacturing"]') as HTMLFormElement;
		expect(form.getAttribute('method')?.toUpperCase()).toBe('POST');
		expect(form.getAttribute('action')).toBe('?/manufacturing');
		expect(form.querySelector<HTMLInputElement>('input[name="manufacturingUse"]:checked')?.value).toBe(
			'zero'
		);
		expect(form.querySelector('[data-manufacturing-use]')?.textContent).toContain(
			'Count it at its buy value on the day the manufacturing job started'
		);
		const me = (id: string) => form.querySelector<HTMLInputElement>(`input[name="me-${id}"]`)!;
		expect([me('3001').value, me('3002').value]).toEqual(['8', '10']);
		expect([me('3001').min, me('3001').max]).toEqual(['0', '10']);
		expect(form.querySelector('[data-blueprint="3001"]')?.textContent).toContain('Widget Blueprint');
		expect(form.textContent).toContain('needs the blueprint permissions included in Profit tracking');
		expect([...new FormData(form).keys()]).toEqual(['manufacturingUse', 'me-3001', 'me-3002']);
	});

	it('Manufacturing without unread blueprints: an empty note, the use choice stays', () => {
		const withManufacturing = data({ blueprints: [] });
		withManufacturing.facilities.list[0].jobs = { reaction: 2, manufacturing: 1 };
		const { container } = renderPage(withManufacturing);
		expect(container.querySelector('[data-no-blueprints]')).not.toBeNull();
		expect(container.querySelector('[data-no-manufacturing]')).toBeNull();
		expect(container.querySelectorAll('input[name="manufacturingUse"]')).toHaveLength(2);
	});

	it('Manufacturing without manufacturing jobs: no claim that blueprints were read', () => {
		const { container } = renderPage(data({ blueprints: [] }));
		expect(container.querySelector('[data-no-blueprints]')).toBeNull();
		expect(container.querySelector('[data-no-manufacturing]')).not.toBeNull();
	});

	it('Default period: the stored period is selected in its own form', () => {
		const { container } = renderPage(data(), { form: 'period', notice: 'Saved.' });
		expect(select(container, 'defaultPeriod').value).toBe('90');
		expect([...select(container, 'defaultPeriod').options].map((o) => o.textContent)).toEqual([
			'7 days',
			'30 days',
			'90 days',
			'1 year',
			'All time'
		]);
		const notice = container.querySelector('[role="status"]')!;
		expect(notice.closest('form')?.dataset.form).toBe('period');
	});
});
