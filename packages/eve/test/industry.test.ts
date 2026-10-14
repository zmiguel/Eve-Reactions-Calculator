import { describe, expect, it, vi } from 'vitest';
import {
	ESI_COMPAT_DATE,
	createEsiClient,
	fetchCharacterIndustryJobs,
	fetchCorporationIndustryJobs,
	jobsInventory,
	type IndustryJobRow
} from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, attempts: 1, sleep: vi.fn(async () => {}) })
	};
}

const ESI_JOB = {
	job_id: 7,
	installer_id: 9001,
	facility_id: 1035000000001,
	activity_id: 9,
	blueprint_id: 555,
	blueprint_type_id: 46166,
	blueprint_location_id: 1035000000001,
	output_location_id: 1035000000001,
	runs: 30,
	status: 'active',
	duration: 3600,
	start_date: '2026-10-12T10:00:00Z',
	end_date: '2026-10-12T11:00:00Z'
};

const JOB: IndustryJobRow = {
	jobId: 7,
	installerId: 9001,
	activityId: 9,
	blueprintId: 555,
	blueprintTypeId: 46166,
	productTypeId: null,
	stationId: 1035000000001,
	facilityId: 1035000000001,
	outputLocationId: 1035000000001,
	status: 'active',
	runs: 30,
	cost: null,
	startDate: Date.UTC(2026, 9, 12, 10),
	endDate: Date.UTC(2026, 9, 12, 11),
	completedDate: null
};

describe('industry job clients', () => {
	it('fetches character jobs with the bearer token and compatibility date', async () => {
		const { esi, calls } = esiWith(() => json([{ ...ESI_JOB, station_id: 1035000000001 }]));
		expect(await fetchCharacterIndustryJobs(esi, 9001, 'tok')).toEqual({
			ok: true,
			items: [JOB],
			pages: 1,
			lastModified: null,
			expiresAt: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/industry/jobs');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
		expect(calls[0]!.headers.get('X-Compatibility-Date')).toBe(ESI_COMPAT_DATE);
	});

	it('fetches corporation job pages and maps location_id to the station', async () => {
		const { esi, calls } = esiWith(() =>
			json([{ ...ESI_JOB, location_id: 60003760 }], { headers: { 'X-Pages': '2' } })
		);
		expect(await fetchCorporationIndustryJobs(esi, 98000001, 'tok', 2)).toEqual({
			ok: true,
			items: [{ ...JOB, stationId: 60003760 }],
			pages: 2,
			lastModified: null,
			expiresAt: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/corporations/98000001/industry/jobs?page=2');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('asks for completed jobs and maps their product, cost, dates and expiry', async () => {
		const { esi, calls } = esiWith(() =>
			json(
				[
					{
						...ESI_JOB,
						station_id: 60003760,
						product_type_id: 16663,
						cost: 1234567.89,
						status: 'delivered',
						completed_date: '2026-10-12T11:05:30Z',
						completed_character_id: 9001
					}
				],
				{ headers: { Expires: 'Mon, 12 Oct 2026 12:00:00 GMT' } }
			)
		);
		expect(await fetchCharacterIndustryJobs(esi, 9001, 'tok', { includeCompleted: true })).toEqual({
			ok: true,
			items: [
				{
					...JOB,
					stationId: 60003760,
					productTypeId: 16663,
					cost: 1234567.89,
					status: 'delivered',
					completedDate: Date.UTC(2026, 9, 12, 11, 5, 30)
				}
			],
			pages: 1,
			lastModified: null,
			expiresAt: Date.UTC(2026, 9, 12, 12)
		});
		expect(calls[0]!.url).toBe(
			'https://esi.evetech.net/characters/9001/industry/jobs?include_completed=true'
		);
	});

	it('asks a corporation page for completed jobs', async () => {
		const { esi, calls } = esiWith(() => json([]));
		await fetchCorporationIndustryJobs(esi, 98000001, 'tok', 3, { includeCompleted: true });
		const url = new URL(calls[0]!.url);
		expect(url.pathname).toBe('/corporations/98000001/industry/jobs');
		expect(Object.fromEntries(url.searchParams)).toEqual({ include_completed: 'true', page: '3' });
	});

	it('returns 403 typed instead of throwing', async () => {
		const { esi } = esiWith(() => json({ error: 'forbidden' }, { status: 403 }));
		expect(await fetchCorporationIndustryJobs(esi, 98000001, 'tok', 1)).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
	});
});

describe('jobsInventory', () => {
	const job = (over: Partial<IndustryJobRow>): IndustryJobRow => ({ ...JOB, ...over });

	it('counts each holding reaction job once at its station or structure', () => {
		const jobs = [
			job({ jobId: 1 }),
			job({ jobId: 2, status: 'paused' }),
			job({ jobId: 3, status: 'ready', stationId: 60003760 }),
			job({ jobId: 4, status: 'delivered' }),
			job({ jobId: 5, status: 'cancelled' }),
			job({ jobId: 6, activityId: 1 }),
			job({ jobId: 8, blueprintTypeId: 999 }),
			// The SDE's number for Reactions; ESI reports 9 (jobs 1 to 3).
			job({ jobId: 9, activityId: 11, stationId: 60003760 })
		];
		expect(jobsInventory(jobs, new Set([46166]))).toEqual({
			locations: [
				{ locationId: 60003760, kind: 'station' },
				{ locationId: 1035000000001, kind: 'structure' }
			],
			items: [
				{ locationId: 60003760, bucket: 'jobs', typeId: 46166, quantity: 2 },
				{ locationId: 1035000000001, bucket: 'jobs', typeId: 46166, quantity: 2 }
			]
		});
	});

	it('is empty without relevant jobs', () => {
		expect(jobsInventory([job({ status: 'delivered' })], new Set([46166]))).toEqual({
			locations: [],
			items: []
		});
	});
});
