import { describe, expect, it, vi } from 'vitest';
import { asEnv, fakeEnv } from '../../test/fakes';
import { publishMarket, triggerUpdater, type InlineRunResult } from './updater';

function stub() {
	return {
		triggerPriceRefresh: vi.fn(async () => ({ instanceId: 'prices-manual-1' })),
		triggerSdeSync: vi.fn(async (_force: boolean) => ({ instanceId: 'sde-3569502-manual-1' })),
		triggerDaily: vi.fn(async (date: string) => ({ instanceId: `daily-${date}-manual-1` })),
		triggerCostIndices: vi.fn(async (): Promise<InlineRunResult> => ({
			runId: 'cost_indices-manual-1',
			status: 'ok',
			summary: 'not modified (expires 2026-10-07T12:00:00.000Z)'
		})),
		publishMarketSnapshot: vi.fn(async () => ({ snapshotAt: 1, hubIds: ['jita', 'amarr'] }))
	};
}

describe('triggerUpdater', () => {
	it('calls the RPC method for each action with its arguments', async () => {
		const UPDATER = stub();
		const env = asEnv(fakeEnv({ UPDATER }));
		expect(await triggerUpdater(env, 'prices', '2026-10-07')).toEqual({
			ok: true,
			text: 'Price refresh started: workflow instance prices-manual-1.'
		});
		await triggerUpdater(env, 'sde_check', '2026-10-07');
		await triggerUpdater(env, 'sde_force', '2026-10-07');
		await triggerUpdater(env, 'daily', '2026-10-07');
		expect(UPDATER.triggerPriceRefresh).toHaveBeenCalledWith();
		expect(UPDATER.triggerSdeSync.mock.calls).toEqual([[false], [true]]);
		expect(UPDATER.triggerDaily).toHaveBeenCalledWith('2026-10-07');
		expect(await triggerUpdater(env, 'market_snapshot', '2026-10-07')).toEqual({
			ok: true,
			text: 'Market snapshot published with 2 public hubs.'
		});
	});

	it('reports a skipped SDE sync', async () => {
		const UPDATER = { ...stub(), triggerSdeSync: vi.fn(async () => ({ skipped: true as const, build: 7 })) };
		expect((await triggerUpdater(asEnv(fakeEnv({ UPDATER })), 'sde_check', '2026-10-07')).text).toBe(
			'SDE sync skipped: build 7 is already imported.'
		);
	});

	it('reports the outcome of an inline run, a failed run as an error notice', async () => {
		const UPDATER = stub();
		const env = asEnv(fakeEnv({ UPDATER }));
		expect(await triggerUpdater(env, 'cost_indices', '2026-10-07')).toEqual({
			ok: true,
			text: 'Cost indices run cost_indices-manual-1 finished: not modified (expires 2026-10-07T12:00:00.000Z).'
		});
		UPDATER.triggerCostIndices.mockResolvedValueOnce({
			runId: 'cost_indices-manual-2',
			status: 'failed',
			summary: 'Error: ESI 400'
		});
		expect(await triggerUpdater(env, 'cost_indices', '2026-10-07')).toEqual({
			ok: false,
			text: 'Cost indices run cost_indices-manual-2 failed: Error: ESI 400'
		});
	});

	it('turns an unreachable updater or a missing binding into an error notice', async () => {
		const UPDATER = {
			...stub(),
			triggerPriceRefresh: vi.fn(async () => {
				throw new Error('Couldn’t find a local dev session for the "UpdaterRpc" entrypoint');
			})
		};
		const down = await triggerUpdater(asEnv(fakeEnv({ UPDATER })), 'prices', '2026-10-07');
		expect(down.ok).toBe(false);
		expect(down.text).toContain('local dev session');
		expect(down.text).toContain('npm run dev -w apps/updater');
		expect(await triggerUpdater(asEnv(fakeEnv()), 'daily', '2026-10-07')).toEqual({
			ok: false,
			text: 'Daily job not started: the UPDATER binding is missing.'
		});
	});
});

describe('publishMarket', () => {
	it('calls publishMarketSnapshot and reports whether the updater answered', async () => {
		const publishMarketSnapshot = vi.fn(async () => ({ snapshotAt: 1, hubIds: ['jita'] }));
		expect(await publishMarket(asEnv(fakeEnv({ UPDATER: { publishMarketSnapshot } })))).toBe(true);
		expect(publishMarketSnapshot).toHaveBeenCalledWith();
		const failing = vi.fn(async () => {
			throw new Error('connection refused');
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await publishMarket(asEnv(fakeEnv({ UPDATER: { publishMarketSnapshot: failing } })))).toBe(false);
		expect(await publishMarket(asEnv(fakeEnv()))).toBe(false);
	});
});
