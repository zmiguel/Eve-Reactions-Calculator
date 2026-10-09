<script lang="ts">
	import type { PlanStartup } from '@reactions/engine';
	import InfoNote from '$lib/components/InfoNote.svelte';
	import { startupSummary } from '$lib/startup';

	interface Props {
		startup: PlanStartup;
		/** Blueprint type id → reaction name. */
		names: ReadonlyMap<number, string>;
	}

	let { startup, names }: Props = $props();
	const note = $derived(startupSummary(startup, names));
</script>

{#if note}
	<InfoNote name="startup-choice">
		{#if note.title}<p class="font-semibold" data-startup-title>{note.title}</p>{/if}
		<ul class="mt-0.5 list-disc space-y-0.5 ps-5">
			{#each note.points as point (point)}
				<li>{point}</li>
			{/each}
		</ul>
	</InfoNote>
{/if}
