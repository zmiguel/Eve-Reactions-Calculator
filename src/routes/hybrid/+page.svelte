<script>
	import { DataHandler } from '@vincjo/datatables';
	import TH from '../TH.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();

	const hybridHandler = new DataHandler(data.results, { rowsPerPage: 50 });
	const hybridRows = hybridHandler.getRows();

	const nFormat = new Intl.NumberFormat();

	function rowClickHandler(e) {
		if (e.ctrlKey || e.metaKey || e.button == 1) {
			window.open(e.currentTarget.dataset.href, '_blank');
		} else {
			goto(e.currentTarget.dataset.href);
		}
	}

	onMount(() => {
		hybridHandler.sortAsc('name');
	});
</script>

<svelte:head>
	<title>Hybrid Reactions</title>
</svelte:head>

<div class="container">
	<div class="row">
		<table class="table table-sm table-bordered text-center">
			<thead>
				<tr>
					<th>In Method</th>
					<th>Out Method</th>
					<th>Market</th>
					<th>Reactions</th>
					<th>Facility</th>
					<th>Rig</th>
					<th>Space</th>
					<th>System</th>
					<th>IndyTax</th>
					<th>SCC</th>
					<th>Build Time</th>
				</tr>
			</thead>
			<tbody class="table-group-divider">
				<tr class="">
					<td>{data.input} ({data.inMarket})</td>
					<td>{data.output} ({data.outMarket})</td>
					<td>B: {data.brokers} | S: {data.sales}</td>
					<td>Level {data.skill}</td>
					<td>{data.facility} Refinery</td>
					<td>Tech {data.rigs} Rig</td>
					<td>{data.space}</td>
					<td>{data.system}</td>
					<td>{data.tax}</td>
					<td>{data.scc}</td>
					<td>{data.duration} Minutes</td>
				</tr>
			</tbody>
		</table>
	</div>

	<div class="row mt-4">
		<div class="card w-100 p-0">
			<div class="card-header bg-info text-white fw-bold text-center w-100">Hybrid Reactions</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={hybridHandler} orderBy="name">Reaction</TH>
					<TH handler={hybridHandler} orderBy="input_total">Inputs</TH>
					<TH handler={hybridHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={hybridHandler} orderBy="output_total">Output</TH>
					<TH handler={hybridHandler} orderBy="profit">Profit</TH>
					<TH handler={hybridHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results}
						{#each $hybridRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/hybrid/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{nFormat.format(reaction.input_total)}</td>
								<td class="isk">{nFormat.format(reaction.taxes_total)}</td>
								<td class="isk">{nFormat.format(reaction.output_total)}</td>
								<td class="isk">{nFormat.format(reaction.profit)}</td>
								<td>{nFormat.format(reaction.profit_per)} %</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>
