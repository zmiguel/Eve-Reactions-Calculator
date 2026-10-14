<script lang="ts" module>
	import type { JobMark } from '$lib/jobs/types';

	/** What each mark means, shown as its tooltip. */
	export const MARK_TEXT: Record<JobMark, string> = {
		market_fallback:
			'Market estimate: no purchase was found for some inputs, so they are valued at their market price when the job started. You can correct them on the job page.',
		unpriced_input: 'Some inputs have no price at all, so the cost is too low.',
		no_cost: 'No job cost was recorded for this job.',
		unknown_formula: 'This formula is not in the reaction list, so its inputs could not be worked out.'
	};
</script>

<script lang="ts">
	import {
		ExclamationCircleOutline,
		QuestionCircleOutline,
		ReceiptOutline,
		TagOutline
	} from 'flowbite-svelte-icons';

	/** Small icons for the things that make a job's numbers less certain; the tooltip explains each. */
	let { marks }: { marks: readonly JobMark[] } = $props();

	const ICON = {
		market_fallback: TagOutline,
		unpriced_input: QuestionCircleOutline,
		no_cost: ReceiptOutline,
		unknown_formula: ExclamationCircleOutline
	} as const;
	const TONE: Record<JobMark, string> = {
		market_fallback: 'text-amber-600 dark:text-amber-400',
		unpriced_input: 'text-red-600 dark:text-red-400',
		no_cost: 'text-gray-500 dark:text-gray-400',
		unknown_formula: 'text-red-600 dark:text-red-400'
	};
</script>

{#if marks.length}
	<span class="inline-flex items-center gap-1" data-marks>
		{#each marks as mark (mark)}
			{@const Icon = ICON[mark]}
			<span class="cursor-help {TONE[mark]}" title={MARK_TEXT[mark]} data-mark={mark}>
				<Icon class="h-4 w-4" aria-hidden="true" />
				<span class="sr-only">{MARK_TEXT[mark]}</span>
			</span>
		{/each}
	</span>
{/if}
