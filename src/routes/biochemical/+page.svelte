<script>
	import { DataHandler } from '@vincjo/datatables';
	import TH from '../TH.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	export let data;

	const synthHandler = new DataHandler(data.results.synth, { rowsPerPage: 50 });
	const synthRows = synthHandler.getRows();

	const standardHandler = new DataHandler(data.results.standard, { rowsPerPage: 50 });
	const standardRows = standardHandler.getRows();

	const improvedHandler = new DataHandler(data.results.improved, { rowsPerPage: 50 });
	const improvedRows = improvedHandler.getRows();

	const improvedChainHandler = new DataHandler(data.results.improved_chain, { rowsPerPage: 50 });
	const improvedChainRows = improvedChainHandler.getRows();

	const strongHandler = new DataHandler(data.results.strong, { rowsPerPage: 50 });
	const strongRows = strongHandler.getRows();

	const strongChainHandler = new DataHandler(data.results.strong_chain, { rowsPerPage: 50 });
	const strongChainRows = strongChainHandler.getRows();

	const nFormat = new Intl.NumberFormat();

	function rowClickHandler(e) {
		if (e.ctrlKey || e.metaKey || e.button == 1) {
			window.open(e.currentTarget.dataset.href, '_blank');
		} else {
			goto(e.currentTarget.dataset.href);
		}
	}

	onMount(() => {
		synthHandler.sortAsc('name');
		standardHandler.sortAsc('name');
		improvedHandler.sortAsc('name');
		improvedChainHandler.sortAsc('name');
		strongHandler.sortAsc('name');
		strongChainHandler.sortAsc('name');
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
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Synth Booster Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={synthHandler} orderBy="name">Reaction</TH>
					<TH handler={synthHandler} orderBy="input_total">Inputs</TH>
					<TH handler={synthHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={synthHandler} orderBy="output_total">Output</TH>
					<TH handler={synthHandler} orderBy="profit">Profit</TH>
					<TH handler={synthHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.synth}
						{#each $synthRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
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

	<div class="row mt-4">
		<div class="card w-100 p-0">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Standard Booster Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={synthHandler} orderBy="name">Reaction</TH>
					<TH handler={synthHandler} orderBy="input_total">Inputs</TH>
					<TH handler={synthHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={synthHandler} orderBy="output_total">Output</TH>
					<TH handler={synthHandler} orderBy="profit">Profit</TH>
					<TH handler={synthHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.standard}
						{#each $standardRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
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

	<div class="row mt-4">
		<div class="card w-100 p-0">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Improved Booster Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={synthHandler} orderBy="name">Reaction</TH>
					<TH handler={synthHandler} orderBy="input_total">Inputs</TH>
					<TH handler={synthHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={synthHandler} orderBy="output_total">Output</TH>
					<TH handler={synthHandler} orderBy="profit">Profit</TH>
					<TH handler={synthHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.improved}
						{#each $improvedRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
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

	<div class="row mt-4">
		<div class="card w-100 p-0">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Improved Booster Chain Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={synthHandler} orderBy="name">Reaction</TH>
					<TH handler={synthHandler} orderBy="input_total">Inputs</TH>
					<TH handler={synthHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={synthHandler} orderBy="output_total">Output</TH>
					<TH handler={synthHandler} orderBy="profit">Profit</TH>
					<TH handler={synthHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.improved_chain}
						{#each $improvedChainRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/chain/{reaction.output.id}"
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

	<div class="row mt-4">
		<div class="card w-100 p-0">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Strong Booster Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={synthHandler} orderBy="name">Reaction</TH>
					<TH handler={synthHandler} orderBy="input_total">Inputs</TH>
					<TH handler={synthHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={synthHandler} orderBy="output_total">Output</TH>
					<TH handler={synthHandler} orderBy="profit">Profit</TH>
					<TH handler={synthHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.strong}
						{#each $strongRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
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

	<div class="row mt-4">
		<div class="card w-100 p-0">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Strong Booster Chain Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={synthHandler} orderBy="name">Reaction</TH>
					<TH handler={synthHandler} orderBy="input_total">Inputs</TH>
					<TH handler={synthHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={synthHandler} orderBy="output_total">Output</TH>
					<TH handler={synthHandler} orderBy="profit">Profit</TH>
					<TH handler={synthHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.strong_chain}
						{#each $strongChainRows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/chain/{reaction.output.id}"
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
