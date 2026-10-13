import { planFromStock } from '@reactions/engine';
import type { StockPlanRequest, StockPlanResponse } from './stockPlanner';

// The web tsconfig has no WebWorker lib (it clashes with DOM); this worker only receives and posts messages.
const scope = self as unknown as Pick<Worker, 'postMessage' | 'addEventListener'>;

scope.addEventListener('message', (event: MessageEvent<StockPlanRequest>) => {
	const { id, input } = event.data;
	const post = (response: StockPlanResponse) => scope.postMessage(response);
	try {
		const plan = planFromStock({
			...input,
			onIncumbent: (incumbent) => post({ id, plan: incumbent, final: false })
		});
		post({ id, plan, final: true });
	} catch (error) {
		post({ id, error: error instanceof Error ? error.message : String(error) });
	}
});
