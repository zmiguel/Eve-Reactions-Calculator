import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createWorkflowInstance } from '../src/workflows/instances.ts';
import { completedInstanceCount, mockedSdeWorkflow } from './helpers.ts';

describe('createWorkflowInstance', () => {
	it('creates an instance once and reports the duplicate id afterwards', async () => {
		const id = 'sde-instances-test';
		await using introspector = await mockedSdeWorkflow();

		expect(await createWorkflowInstance(env.SDE_SYNC, id, { build: 1 })).toEqual({ id, created: true });
		expect(await createWorkflowInstance(env.SDE_SYNC, id, { build: 1 })).toEqual({ id, created: false });
		expect(await completedInstanceCount(introspector)).toBe(1);
	});
});
