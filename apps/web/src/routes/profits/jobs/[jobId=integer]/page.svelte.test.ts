import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobDetailData, JobInputLot, JobLink } from '#lib/jobs/types.js';
import { resetPage, setPage } from '../../../../test/shims/app/state';
import Page from './+page.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);
const DAY = 86_400_000;
const JOB_ID = 7002;
const INPUT = 16654;
const OUTPUT = 16670;

const link = (jobId: number, name: string | null = 'Other Formula', startDate = NOW - 3 * DAY): JobLink => ({
	jobId,
	formula: { blueprintTypeId: 46182, name },
	startDate,
	quantity: 10
});

function lot(lotId: number, overrides: Partial<JobInputLot> = {}): JobInputLot {
	return {
		lotId,
		acquiredAt: NOW - DAY,
		origin: 'transaction',
		priceSource: `Source of lot ${lotId}`,
		quantity: 10,
		unitCost: 5,
		cost: 50,
		madeBy: null,
		correctionRef: null,
		corrected: false,
		correctionNote: null,
		...overrides
	};
}

function detail(overrides: Partial<JobDetailData> = {}): JobDetailData {
	return {
		now: NOW,
		kind: 'reaction',
		materialBonus: {
			facility: 'Reactor One',
			band: 'nullsec',
			source: 'facility',
			reactorSettingsSystem: false,
			parts: [{ kind: 'rig', name: 'Standup L-Set Reactor Efficiency II', reduction: 0.0264 }],
			profileRig: null,
			reduction: 0.0264
		},
		job: {
			jobId: JOB_ID,
			formula: { blueprintTypeId: 46204, name: 'Titanium Carbide Reaction Formula' },
			runs: 1,
			owner: 'Alpha',
			facility: 'Reactor One',
			startDate: NOW - 2 * DAY,
			endDate: NOW - DAY,
			status: 'finished',
			marks: ['market_fallback'],
			inputCost: 200,
			jobCost: 20,
			output: {
				typeId: OUTPUT,
				name: 'Titanium Carbide',
				quantity: 100,
				soldQty: 60,
				usedQty: 10,
				manufacturedQty: 0,
				unsoldQty: 30
			},
			realizedProfit: 168,
			expectedProfit: 222,
			expectedNote: null,
			product: { typeId: OUTPUT, name: 'Titanium Carbide' },
			unitCost: 2.5,
			salesNet: 300,
			runningOutputQty: null,
			realizedNote: null
		},
		inputs: [
			{
				typeId: INPUT,
				name: 'Titanium Chromide',
				quantity: 40,
				cost: 200,
				lots: [
					lot(1),
					lot(2, { origin: 'job', madeBy: link(7001) }),
					lot(3, { origin: 'market', correctionRef: `job:${JOB_ID}:${INPUT}` }),
					lot(4, { origin: 'correction', correctionRef: `job:${JOB_ID}:${INPUT}`, corrected: true })
				]
			}
		],
		output: {
			typeId: OUTPUT,
			name: 'Titanium Carbide',
			quantity: 100,
			soldQty: 60,
			usedQty: 10,
			manufacturedQty: 0,
			unsoldQty: 30,
			sales: [{ ref: 'transaction:902', kind: 'market', at: NOW, quantity: 60, netUnitValue: 5 }],
			usedBy: [link(7009, 'Next Formula')],
			manufacturing: [],
			unitValueNow: 4,
			unsoldValueNow: 120
		},
		chain: { from: [link(7001)], to: [link(7009, 'Next Formula')] },
		rebuiltAt: NOW,
		dirty: false,
		...overrides
	};
}

const withUser = (d: JobDetailData | null) => ({
	user: { characterId: 90000001, name: 'Alpha', isAdmin: false },
	detail: d
});

const renderPage = (d: JobDetailData | null = detail(), form: unknown = null) =>
	render(Page, { props: { data: withUser(d), form, params: { jobId: String(JOB_ID) } } as never });

const lotRow = (container: Element, lotId: number) =>
	container.querySelector(`tr[data-lot="${lotId}"]`) as HTMLTableRowElement;

/** The `action` and hidden fields of every form in a lot row. */
const forms = (row: Element) =>
	[...row.querySelectorAll('form')].map((f) => ({
		action: f.getAttribute('action'),
		method: f.getAttribute('method')?.toUpperCase(),
		fields: Object.fromEntries(
			[...f.querySelectorAll('input[type="hidden"]')].map((i) => [
				i.getAttribute('name'),
				i.getAttribute('value')
			])
		)
	}));

const part = (container: Element, key: string) =>
	container.querySelector(`[data-part="${key}"] [data-isk]`)?.getAttribute('data-isk');

beforeEach(() => setPage({ url: `https://reactions.coalition.space/profits/jobs/${JOB_ID}` }));
afterEach(() => {
	resetPage();
	document.head.innerHTML = '';
});

describe('/profits/jobs/[jobId] page', () => {
	it('renders nothing without a job (the layout shows the gate)', () => {
		expect(renderPage(null).container.querySelector('[data-result]')).toBeNull();
	});

	it('material bonus: the facility and each applied rig with its reduction and band', () => {
		const { container } = renderPage();
		const bonus = container.querySelector('[data-inputs] [data-material-bonus="facility"]')!;
		const text = bonus.textContent!.replace(/\s+/g, ' ');
		expect(text).toContain('2.64% fewer materials at Reactor One (nullsec)');
		expect(bonus.querySelector('[data-bonus-part="rig"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Rig Standup L-Set Reactor Efficiency II: 2.64% (nullsec)'
		);
		expect(bonus.querySelector('[data-profile-rig]')).toBeNull();
		expect(bonus.querySelector('a[href="/account/tracking#facilities"]')).toBeNull();
	});

	it('material bonus: the account reactor settings when the facility is not known', () => {
		const { container } = renderPage(
			detail({
				materialBonus: {
					facility: 'Unknown structure',
					band: null,
					source: 'profile',
					reactorSettingsSystem: false,
					parts: [],
					profileRig: { meRig: 't2', reduction: 0.024, band: 'lowsec' },
					reduction: 0.024
				}
			})
		);
		const bonus = container.querySelector('[data-material-bonus="profile"]')!;
		expect(bonus.querySelector('[data-profile-rig]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'T2 ME rig of your reactor settings: 2.40% (lowsec)'
		);
		expect(bonus.querySelector('[data-bonus-part]')).toBeNull();
		expect(bonus.querySelector('a[href="/account/tracking#facilities"]')).not.toBeNull();
		expect(bonus.querySelector('[data-bonus-note]')?.getAttribute('data-bonus-note')).toBe('unknown');
	});

	it('material bonus: in the reactor settings system, the settings are used on purpose (not "not known")', () => {
		const { container } = renderPage(
			detail({
				materialBonus: {
					facility: '671-ST - Ceres',
					band: 'nullsec',
					source: 'structure_profile_rig',
					reactorSettingsSystem: true,
					parts: [],
					profileRig: { meRig: 't2', reduction: 0.0264, band: 'nullsec' },
					reduction: 0.0264
				}
			})
		);
		expect(container.querySelector('[data-bonus-note]')?.getAttribute('data-bonus-note')).toBe(
			'reactor-system'
		);
	});

	it('a running job shows its cost per unit and an estimated expected profit for the output it will make', () => {
		const { container } = renderPage(
			detail({
				job: {
					...detail().job,
					status: 'running',
					endDate: NOW + DAY,
					output: null,
					realizedProfit: null,
					expectedProfit: 180,
					expectedNote: null,
					unitCost: 2.2,
					salesNet: null,
					runningOutputQty: 100,
					realizedNote: 'Still running: the realized profit is known once its output is sold.'
				},
				output: null
			})
		);
		expect(container.querySelector('[data-unit-cost] [data-isk]')?.getAttribute('data-isk')).toBe('2.2');
		const expected = container.querySelector('[data-profit="expected"]')!;
		expect(expected.querySelector('[data-isk]')?.getAttribute('data-isk')).toBe('180');
		expect(expected.querySelector('[data-estimated]')).not.toBeNull();
		// The realized profit keeps the running job's own reason, not the expected profit's.
		expect(container.querySelector('[data-profit="realized"] [data-isk="none"]')?.getAttribute('title')).toBe(
			'Still running: the realized profit is known once its output is sold.'
		);
	});

	it('no material bonus line without one (no dataset or unknown product)', () => {
		const { container } = renderPage(detail({ materialBonus: null }));
		expect(container.querySelector('[data-material-bonus]')).toBeNull();
	});

	it('header: back link, status, runs, owner and facility', () => {
		const { container } = renderPage();
		expect(container.querySelector('[data-back]')?.getAttribute('href')).toBe('/profits/jobs');
		expect(container.querySelector('h1')?.textContent).toBe('Titanium Carbide Reaction Formula');
		expect(container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('finished');
		expect(container.querySelector('[data-job-facts]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'1 run · Alpha · Reactor One'
		);
		expect(container.querySelector('[data-mark="market_fallback"]')).not.toBeNull();
	});

	it('result: costs, where the output value comes from, profits; estimates marked', () => {
		const { container } = renderPage();
		expect(part(container, 'inputs')).toBe('200');
		expect(part(container, 'job-cost')).toBe('20');
		expect(part(container, 'total-cost')).toBe('220');
		expect(part(container, 'sold')).toBe('300');
		// 10 used by a later job at the unit cost of 2.5.
		expect(part(container, 'used')).toBe('25');
		expect(part(container, 'unsold')).toBe('120');
		expect(part(container, 'output-value')).toBe('445');
		expect(container.querySelector('[data-part="inputs"] [data-estimated]')).not.toBeNull();
		expect(container.querySelector('[data-part="unsold"] [data-estimated]')).not.toBeNull();
		expect(container.querySelector('[data-part="job-cost"] [data-estimated]')).toBeNull();
		const profit = (kind: string) => container.querySelector(`[data-profit="${kind}"] [data-isk]`);
		expect(profit('realized')?.getAttribute('data-isk')).toBe('168');
		expect(profit('expected')?.getAttribute('data-isk')).toBe('222');
		expect(container.querySelector('[data-profit="expected"] [data-estimated]')).not.toBeNull();
		expect(container.querySelector('[data-unit-cost] [data-isk]')?.getAttribute('data-isk')).toBe('2.5');
	});

	it('a running job has no profit yet and says why', () => {
		const base = detail();
		const running = detail({
			job: {
				...base.job,
				status: 'running',
				endDate: NOW + DAY,
				marks: [],
				output: null,
				realizedProfit: null,
				expectedProfit: null,
				expectedNote: 'Still running.',
				realizedNote: 'Still running.',
				salesNet: null,
				unitCost: null
			},
			output: null,
			chain: { from: [], to: [] }
		});
		const { container } = renderPage(running);
		expect(container.querySelector('[data-profit="realized"] [data-isk="none"]')?.getAttribute('title')).toBe(
			'Still running.'
		);
		expect(container.querySelector('[data-profit="expected"] [data-isk="none"]')).not.toBeNull();
		expect(container.querySelector('[data-result] [data-no-output]')).not.toBeNull();
		expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
		expect(container.querySelector('[data-sales]')).toBeNull();
		expect(container.querySelector('[data-chain-from]')).toBeNull();
		expect(container.querySelector('[data-output] [data-no-output]')?.textContent?.trim()).toBe(
			'Still running. It makes Titanium Carbide.'
		);
	});

	it('inputs: one row per material with its source mix, linked to the ledger item', () => {
		const { container } = renderPage();
		// A header row names the columns of the input rows.
		expect(container.querySelectorAll('[data-inputs-head] > span')).toHaveLength(5);
		const input = container.querySelector(`[data-input="${INPUT}"]`)!;
		expect(input.querySelector('[data-item-link]')?.getAttribute('href')).toBe(`/profits/ledger/${INPUT}`);
		expect(input.querySelector('[data-mix]')?.textContent?.trim()).toBe(
			'4 batches: bought, made by job, market estimate, your correction'
		);
		expect(input.querySelector('[data-average] [data-isk]')?.getAttribute('data-isk')).toBe('5');
		expect(lotRow(container, 1).textContent).toContain('Source of lot 1');
		expect(lotRow(container, 2).querySelector('[data-made-by]')?.getAttribute('href')).toBe(
			'/profits/jobs/7001'
		);
	});

	it('correction forms only on market-estimate batches; corrected ones also Undo correction', () => {
		const { container } = renderPage();
		const ref = `job:${JOB_ID}:${INPUT}`;
		expect(forms(lotRow(container, 3))).toEqual([
			{ action: '?/correct', method: 'POST', fields: { kind: 'job_input', ref } }
		]);
		expect(forms(lotRow(container, 4)).map((f) => f.action)).toEqual(['?/correct', '?/undo']);
		for (const id of [1, 2]) expect(lotRow(container, id).querySelector('form')).toBeNull();
	});

	it('a corrected batch shows its price and note once, not the origin twice', () => {
		const ref = `job:${JOB_ID}:${INPUT}`;
		const base = detail();
		const corrected = lot(4, {
			origin: 'correction',
			priceSource: 'Your correction',
			unitCost: 115.5,
			correctionRef: ref,
			corrected: true,
			correctionNote: 'From the corp hangar'
		});
		const { container } = renderPage(detail({ inputs: [{ ...base.inputs[0], lots: [lot(1), corrected] }] }));
		const row = lotRow(container, 4);
		expect(row.querySelector('[data-price-from]')?.textContent?.trim()).toBe('');
		const shown = row.querySelector('[data-correction]')?.textContent ?? '';
		expect(shown).toContain('115.50');
		expect(shown).toContain('From the corp hangar');
		expect(lotRow(container, 1).querySelector('[data-price-from]')?.textContent?.trim()).toBe(
			'Source of lot 1'
		);
	});

	it('a rejected correction opens its input and form, shows one error there and keeps the values typed', () => {
		const ref = `job:${JOB_ID}:${INPUT}`;
		const base = detail();
		const market = lot(3, { origin: 'market', correctionRef: ref });
		const { container } = renderPage(detail({ inputs: [{ ...base.inputs[0], lots: [lot(1), market] }] }), {
			action: 'correct',
			ref,
			error: 'Bad price.',
			values: { unitPrice: 'abc', note: 'typed note' }
		});
		expect(container.querySelector('[data-notice]')).toBeNull();
		const alerts = container.querySelectorAll('[role="alert"]');
		expect(alerts).toHaveLength(1);
		expect(lotRow(container, 3).contains(alerts[0])).toBe(true);
		expect(container.querySelector(`details[data-input="${INPUT}"]`)?.hasAttribute('open')).toBe(true);
		expect(container.querySelector(`details[data-correct="${ref}"]`)?.hasAttribute('open')).toBe(true);
		const field = (name: string) =>
			lotRow(container, 3).querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
		expect(field('unitPrice')).toBe('abc');
		expect(field('note')).toBe('typed note');
	});

	it('an error for no form on the page shows above the result as an alert', () => {
		const { container } = renderPage(detail(), { action: 'correct', ref: 'job:1:2', error: 'Unknown.' });
		expect(container.querySelector('[data-notice="error"]')?.getAttribute('role')).toBe('alert');
	});

	it('chain links tell jobs of the same formula apart by their start', () => {
		const { container } = renderPage(
			detail({
				chain: {
					from: [link(7001, 'Same Formula', NOW - 3 * DAY), link(7003, 'Same Formula', NOW - 4 * DAY)],
					to: []
				}
			})
		);
		const starts = [...container.querySelectorAll('[data-chain-from] [data-job-link-start]')].map((s) =>
			s.getAttribute('data-job-link-start')
		);
		expect(starts).toEqual([String(NOW - 3 * DAY), String(NOW - 4 * DAY)]);
		const texts = [...container.querySelectorAll('[data-chain-from] [data-job-link]')].map(
			(a) => a.textContent
		);
		expect(new Set(texts).size).toBe(2);
	});

	it('output: sales linked to the ledger, later jobs, unsold value; the chain both ways', () => {
		const { container } = renderPage();
		expect(container.querySelector('[data-sale-link]')?.getAttribute('href')).toBe(
			`/profits/ledger?type=${OUTPUT}`
		);
		expect(container.querySelector('[data-unsold] [data-isk]')?.getAttribute('data-isk')).toBe('120');
		const hrefs = (selector: string) =>
			[...container.querySelectorAll(`${selector} a[data-job-link]`)].map((a) => a.getAttribute('href'));
		expect(hrefs('[data-used-by]')).toEqual(['/profits/jobs/7009']);
		expect(hrefs('[data-chain-from]')).toEqual(['/profits/jobs/7001']);
		expect(hrefs('[data-chain-this]')).toEqual([`/profits/jobs/${JOB_ID}`]);
		expect(hrefs('[data-chain-to]')).toEqual(['/profits/jobs/7009']);
	});

	it('output used in manufacturing: a result part, a fourth bar segment and the manufacturing jobs', () => {
		const base = detail();
		const output = {
			...base.output!,
			manufacturedQty: 20,
			unsoldQty: 10,
			unsoldValueNow: 40,
			manufacturing: [
				{
					jobId: 7101,
					product: { typeId: 11186, name: 'Widget' },
					at: NOW - DAY,
					quantity: 20,
					unitValue: 4.5,
					basis: 'buy_value' as const
				}
			]
		};
		const { container } = renderPage(
			detail({
				job: { ...base.job, output: { ...base.job.output!, manufacturedQty: 20, unsoldQty: 10 } },
				output
			})
		);
		expect(part(container, 'manufactured')).toBe('90');
		expect(container.querySelector('[data-part="manufactured"]')?.textContent).toContain('20 units');
		// 300 sold + 25 used + 90 in manufacturing + 40 unsold.
		expect(part(container, 'output-value')).toBe('455');
		const row = container.querySelector('[data-manufacturing] tr[data-manufacturing-job="7101"]')!;
		expect(row.textContent).toContain('Widget');
		expect(row.textContent).not.toContain('7101');
		expect(row.querySelector('img')?.getAttribute('src')).toContain('/types/11186/icon');
		expect(row.querySelector('[data-isk]')?.getAttribute('data-isk')).toBe('4.5');
		expect(row.querySelector('[data-basis]')?.textContent).toBe('buy value');
		expect(
			[...container.querySelectorAll<HTMLElement>('[data-output] [data-segment]')].map(
				(s) => s.dataset.segment
			)
		).toContain('used in manufacturing');

		const atCost = renderPage(
			detail({ output: { ...output, manufacturing: [{ ...output.manufacturing[0], basis: 'cost' }] } })
		).container;
		expect(atCost.querySelector('[data-basis]')?.textContent).toBe('at cost');
	});

	it('without manufacturing use: no manufacturing part or list', () => {
		const { container } = renderPage();
		expect(container.querySelector('[data-part="manufactured"]')).toBeNull();
		expect(container.querySelector('[data-manufacturing]')).toBeNull();
	});

	describe('a fuel block job', () => {
		const fuel = (overrides: Partial<JobDetailData> = {}) => {
			const base = detail();
			return detail({
				kind: 'fuel_block',
				materialBonus: null,
				job: {
					...base.job,
					formula: { blueprintTypeId: 4314, name: 'Nitrogen Fuel Block Blueprint' },
					runs: 10,
					marks: ['market_fallback'],
					// 10 runs × 40 blocks: (3 000 inputs + 200 job cost) / 400 = 8 each.
					inputCost: 3000,
					jobCost: 200,
					unitCost: 8,
					output: { ...base.job.output!, quantity: 400, soldQty: 0, usedQty: 300, unsoldQty: 100 },
					realizedProfit: 0,
					expectedProfit: 100,
					product: { typeId: 4051, name: 'Nitrogen Fuel Block' }
				},
				output: {
					...base.output!,
					typeId: 4051,
					name: 'Nitrogen Fuel Block',
					quantity: 400,
					soldQty: 0,
					usedQty: 300,
					unsoldQty: 100,
					sales: [],
					usedBy: [link(7009, 'Next Formula')]
				},
				chain: { from: [], to: [link(7009, 'Next Formula')] },
				...overrides
			});
		};

		it('shows its costs and cost per block, with no profit of its own', () => {
			const { container } = renderPage(fuel());
			expect(container.querySelector('h1')?.textContent).toBe('Nitrogen Fuel Block Blueprint');
			expect(container.querySelector('[data-job-facts] [data-fuel-block]')).not.toBeNull();
			expect(part(container, 'inputs')).toBe('3000');
			expect(part(container, 'total-cost')).toBe('3200');
			expect(container.querySelector('[data-unit-cost] [data-isk]')?.getAttribute('data-isk')).toBe('8');
			expect(container.querySelector('[data-profit]')).toBeNull();
			expect(container.querySelector('[data-part="output-value"]')).toBeNull();
			expect(container.querySelector('[data-material-bonus]')).toBeNull();
			// Its output goes to the reaction jobs that used it.
			expect(container.querySelector('[data-used-by] [data-job-link="7009"]')).not.toBeNull();
			// An input without a purchase can be corrected as on a reaction job.
			expect(forms(lotRow(container, 3)).map((f) => f.fields.ref)).toContain(`job:${JOB_ID}:${INPUT}`);
		});

		it('while running: the blocks it will make, no expected profit', () => {
			const base = fuel();
			const { container } = renderPage(
				fuel({
					job: {
						...base.job,
						status: 'running',
						endDate: NOW + DAY,
						output: null,
						realizedProfit: null,
						expectedProfit: null,
						runningOutputQty: 400
					},
					output: null
				})
			);
			expect(container.querySelector('[data-no-output]')?.textContent).toContain('400');
			expect(container.querySelector('[data-profit]')).toBeNull();
			expect(container.querySelector('[data-unit-cost] [data-isk]')?.getAttribute('data-isk')).toBe('8');
		});
	});

	it('a reaction job shows its profits', () => {
		const { container } = renderPage();
		expect(container.querySelector('[data-profit="realized"]')).not.toBeNull();
		expect(container.querySelector('[data-job-facts] [data-fuel-block]')).toBeNull();
	});
});
