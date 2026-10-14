<script lang="ts">
	import type { GrantableFeature } from '@reactions/eve';
	import type { Snippet } from 'svelte';
	import PermissionsForm from './PermissionsForm.svelte';

	interface Props {
		character: { characterId: number; name: string; features: readonly GrantableFeature[] };
		offeredFeatures: readonly GrantableFeature[];
		/** Classes of the trigger (a link to `/account/permissions/<id>`, which works without JS). */
		triggerClass: string;
		/** Trigger content (an icon); its accessible name is "Edit permissions of <name>". */
		children: Snippet;
	}

	let { character, offeredFeatures, triggerClass, children }: Props = $props();

	let open = $state(false);
	let dialog: HTMLDialogElement | undefined = $state();
	let trigger: HTMLAnchorElement | undefined = $state();
	const titleId = $derived(`permissions-title-${character.characterId}`);

	function show(event: MouseEvent) {
		// Modifier clicks keep the link's default (open the plain page in a new tab).
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		open = true;
		dialog?.showModal();
	}

	function close() {
		if (!open) return;
		open = false;
		dialog?.close();
		trigger?.focus();
	}

	const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"])';

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}
		if (event.key !== 'Tab' || !dialog) return;
		// Keep Tab inside the dialog.
		const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	$effect(() => {
		// Focus the first checkbox once the dialog content is rendered.
		if (open) dialog?.querySelector<HTMLElement>('input[type="checkbox"]')?.focus();
	});

	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<a
	bind:this={trigger}
	href="/account/permissions/{character.characterId}"
	class={triggerClass}
	aria-haspopup="dialog"
	aria-label="Edit permissions of {character.name}"
	title="Edit permissions"
	onclick={show}>{@render children()}</a
>

<dialog
	bind:this={dialog}
	aria-labelledby={titleId}
	aria-modal="true"
	{onkeydown}
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
	onclick={(event) => {
		// A click on the backdrop (the dialog element itself, outside its box) closes it.
		if (event.target === dialog) close();
	}}
	class="m-auto w-full max-w-lg rounded-lg bg-white p-0 text-left text-gray-800 shadow-xl backdrop:bg-gray-900/60 dark:bg-gray-800 dark:text-gray-200"
>
	{#if open}
		<div class="p-5">
			<h2 id={titleId} class="mb-3 text-base font-semibold text-gray-900 dark:text-white">
				Permissions of {character.name}
			</h2>
			<PermissionsForm {character} {offeredFeatures}>
				{#snippet actions()}
					<button type="button" class={button} onclick={close}>Cancel</button>
				{/snippet}
			</PermissionsForm>
		</div>
	{/if}
</dialog>
