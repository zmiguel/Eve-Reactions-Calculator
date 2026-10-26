<script lang="ts">
	import PagedTable from '#lib/components/profits/PagedTable.svelte';
	import type { Paged } from '#lib/paging.js';

	let {
		data,
		param = 'p',
		endpoint = '/profits/data/test'
	}: { data: Paged<{ id: number; name: string }>; param?: string; endpoint?: string } = $props();
</script>

<PagedTable {data} {param} {endpoint} label="Test rows" noun="items">
	{#snippet head()}
		<tr><th>Name</th></tr>
	{/snippet}
	{#snippet row(item)}
		<tr data-row={item.id}><td>{item.name}</td></tr>
	{/snippet}
	{#snippet empty()}
		<p data-empty>Nothing yet.</p>
	{/snippet}
</PagedTable>
