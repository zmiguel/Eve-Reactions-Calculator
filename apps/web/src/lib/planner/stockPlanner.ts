import { planFromStock, type StockPlan, type StockPlanInput } from '@reactions/engine';

/**
 * Plans one "Use what I have" request; aborting `signal` stops the run and rejects with its reason.
 * `onIncumbent` receives each better plan found while the search runs (runners may skip it).
 */
export type StockPlanner = (
	input: StockPlanInput,
	signal: AbortSignal,
	onIncumbent?: (plan: StockPlan) => void
) => Promise<StockPlan>;

/** A request to the worker, tagged so only the answers to the latest one are used. */
export interface StockPlanRequest {
	id: number;
	input: StockPlanInput;
}

/** An incumbent (`final: false`, any number) or the result (`final: true`, last). */
export type StockPlanResponse =
	{ id: number; plan: StockPlan; final: boolean } | { id: number; error: string };

/** Plans on the calling thread, without incumbents: where no Web Worker exists (server render, tests). */
export const planOnThread: StockPlanner = async (input, signal) => {
	signal.throwIfAborted();
	return planFromStock(input);
};

/**
 * Plans in a Web Worker so the page never freezes. An aborted run terminates the worker (no stale CPU
 * burn); the next run starts a fresh one. `dispose` stops the worker for good.
 */
export function workerStockPlanner(): { plan: StockPlanner; dispose: () => void } {
	let worker: Worker | null = null;
	let lastId = 0;
	const stop = (target: Worker) => {
		target.terminate();
		if (worker === target) worker = null;
	};

	const plan: StockPlanner = (input, signal, onIncumbent) => {
		const { promise, resolve, reject } = Promise.withResolvers<StockPlan>();
		if (signal.aborted) {
			reject(signal.reason);
			return promise;
		}
		const id = ++lastId;
		worker ??= new Worker(new URL('./stockPlan.worker.ts', import.meta.url), { type: 'module' });
		const current = worker;
		const settle = () => {
			current.removeEventListener('message', onMessage);
			current.removeEventListener('error', onError);
			signal.removeEventListener('abort', onAbort);
		};
		const onMessage = (event: MessageEvent<StockPlanResponse>) => {
			if (event.data.id !== id) return;
			if ('plan' in event.data && !event.data.final) {
				onIncumbent?.(event.data.plan);
				return;
			}
			settle();
			if ('plan' in event.data) resolve(event.data.plan);
			else reject(new Error(event.data.error));
		};
		const onError = (event: ErrorEvent) => {
			settle();
			stop(current);
			reject(new Error(event.message));
		};
		const onAbort = () => {
			settle();
			stop(current);
			reject(signal.reason);
		};
		current.addEventListener('message', onMessage);
		current.addEventListener('error', onError);
		signal.addEventListener('abort', onAbort);
		current.postMessage({ id, input } satisfies StockPlanRequest);
		return promise;
	};

	return { plan, dispose: () => worker && stop(worker) };
}
