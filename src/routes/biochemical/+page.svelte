<script>
	import { DataHandler } from '@vincjo/datatables';
	import TH from '../TH.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	export let data;

	const bioHandler = new DataHandler(data.results.simple, { rowsPerPage: 50 });
	const bioRows = bioHandler.getRows();

	const nFormat = new Intl.NumberFormat();

	function rowClickHandler(e) {
		if (e.ctrlKey || e.metaKey || e.button == 1) {
			window.open(e.currentTarget.dataset.href, '_blank');
		} else {
			goto(e.currentTarget.dataset.href);
		}
	}

	onMount(() => {
		bioHandler.sortAsc('name');
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
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Biochemical Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={bioHandler} orderBy="name">Reaction</TH>
					<TH handler={bioHandler} orderBy="input_total">Inputs</TH>
					<TH handler={bioHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={bioHandler} orderBy="output_total">Output</TH>
					<TH handler={bioHandler} orderBy="profit">Profit</TH>
					<TH handler={bioHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.simple}
						{#each $bioRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/{reaction.output.id}"
								on:click={rowClickHandler}
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
