<script>
	import { TableHandler } from '@vincjo/datatables/server';
	import TH from '../TH.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();

	const synthHandler = new TableHandler(data.results.synth, { rowsPerPage: 50 });

	const standardHandler = new TableHandler(data.results.standard, { rowsPerPage: 50 });

	const improvedHandler = new TableHandler(data.results.improved, { rowsPerPage: 50 });

	const improvedChainHandler = new TableHandler(data.results.improved_chain, { rowsPerPage: 50 });

	const strongHandler = new TableHandler(data.results.strong, { rowsPerPage: 50 });

	const strongChainHandler = new TableHandler(data.results.strong_chain, { rowsPerPage: 50 });

	const molecularHandler = new TableHandler(data.results.molecular, { rowsPerPage: 50 });

	const nFormat = new Intl.NumberFormat();

	/**
	 * @param {number | undefined} value - The number to format
	 * @returns {string} Formatted number or empty string if undefined
	 */
	function formatNumber(value) {
		return value !== undefined ? nFormat.format(value) : '0';
	}

	function rowClickHandler(e) {
		if (e.ctrlKey || e.metaKey || e.button == 1) {
			window.open(e.currentTarget.dataset.href, '_blank');
		} else {
			goto(e.currentTarget.dataset.href);
		}
	}

	onMount(() => {
		const synthSort = synthHandler.createSort('name');
		synthSort.set('asc');
		const standardSort = standardHandler.createSort('name');
		standardSort.set('asc');
		const improvedSort = improvedHandler.createSort('name');
		improvedSort.set('asc');
		const improvedChainSort = improvedChainHandler.createSort('name');
		improvedChainSort.set('asc');
		const strongSort = strongHandler.createSort('name');
		strongSort.set('asc');
		const strongChainSort = strongChainHandler.createSort('name');
		strongChainSort.set('asc');
		const molecularSort = molecularHandler.createSort('name');
		molecularSort.set('asc');
	});
</script>

<svelte:head>
	<title>Biochemical Reactions</title>
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
						{#each synthHandler.rows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{formatNumber(reaction.input_total)}</td>
								<td class="isk">{formatNumber(reaction.taxes_total)}</td>
								<td class="isk">{formatNumber(reaction.output_total)}</td>
								<td class="isk">{formatNumber(reaction.profit)}</td>
								<td>{formatNumber(reaction.profit_per)} %</td>
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
					<TH handler={standardHandler} orderBy="name">Reaction</TH>
					<TH handler={standardHandler} orderBy="input_total">Inputs</TH>
					<TH handler={standardHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={standardHandler} orderBy="output_total">Output</TH>
					<TH handler={standardHandler} orderBy="profit">Profit</TH>
					<TH handler={standardHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.standard}
						{#each standardHandler.rows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{formatNumber(reaction.input_total)}</td>
								<td class="isk">{formatNumber(reaction.taxes_total)}</td>
								<td class="isk">{formatNumber(reaction.output_total)}</td>
								<td class="isk">{formatNumber(reaction.profit)}</td>
								<td>{formatNumber(reaction.profit_per)} %</td>
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
					<TH handler={improvedHandler} orderBy="name">Reaction</TH>
					<TH handler={improvedHandler} orderBy="input_total">Inputs</TH>
					<TH handler={improvedHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={improvedHandler} orderBy="output_total">Output</TH>
					<TH handler={improvedHandler} orderBy="profit">Profit</TH>
					<TH handler={improvedHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.improved}
						{#each improvedHandler.rows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{formatNumber(reaction.input_total)}</td>
								<td class="isk">{formatNumber(reaction.taxes_total)}</td>
								<td class="isk">{formatNumber(reaction.output_total)}</td>
								<td class="isk">{formatNumber(reaction.profit)}</td>
								<td>{formatNumber(reaction.profit_per)} %</td>
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
					<TH handler={improvedChainHandler} orderBy="name">Reaction</TH>
					<TH handler={improvedChainHandler} orderBy="input_total">Inputs</TH>
					<TH handler={improvedChainHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={improvedChainHandler} orderBy="output_total">Output</TH>
					<TH handler={improvedChainHandler} orderBy="profit">Profit</TH>
					<TH handler={improvedChainHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.improved_chain}
						{#each improvedChainHandler.rows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/chain/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{formatNumber(reaction.input_total)}</td>
								<td class="isk">{formatNumber(reaction.taxes_total)}</td>
								<td class="isk">{formatNumber(reaction.output_total)}</td>
								<td class="isk">{formatNumber(reaction.profit)}</td>
								<td>{formatNumber(reaction.profit_per)} %</td>
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
					<TH handler={strongHandler} orderBy="name">Reaction</TH>
					<TH handler={strongHandler} orderBy="input_total">Inputs</TH>
					<TH handler={strongHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={strongHandler} orderBy="output_total">Output</TH>
					<TH handler={strongHandler} orderBy="profit">Profit</TH>
					<TH handler={strongHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.strong}
						{#each strongHandler.rows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{formatNumber(reaction.input_total)}</td>
								<td class="isk">{formatNumber(reaction.taxes_total)}</td>
								<td class="isk">{formatNumber(reaction.output_total)}</td>
								<td class="isk">{formatNumber(reaction.profit)}</td>
								<td>{formatNumber(reaction.profit_per)} %</td>
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
					<TH handler={strongChainHandler} orderBy="name">Reaction</TH>
					<TH handler={strongChainHandler} orderBy="input_total">Inputs</TH>
					<TH handler={strongChainHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={strongChainHandler} orderBy="output_total">Output</TH>
					<TH handler={strongChainHandler} orderBy="profit">Profit</TH>
					<TH handler={strongChainHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.strong_chain}
						{#each strongChainHandler.rows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/chain/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{formatNumber(reaction.input_total)}</td>
								<td class="isk">{formatNumber(reaction.taxes_total)}</td>
								<td class="isk">{formatNumber(reaction.output_total)}</td>
								<td class="isk">{formatNumber(reaction.profit)}</td>
								<td>{formatNumber(reaction.profit_per)} %</td>
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
				Molecular-Forging Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<TH handler={molecularHandler} orderBy="name">Reaction</TH>
					<TH handler={molecularHandler} orderBy="input_total">Inputs</TH>
					<TH handler={molecularHandler} orderBy="taxes_total">Tax</TH>
					<TH handler={molecularHandler} orderBy="output_total">Output</TH>
					<TH handler={molecularHandler} orderBy="profit">Profit</TH>
					<TH handler={molecularHandler} orderBy="profit_per">% prof.</TH>
				</thead>
				<tbody>
					{#if data.results.molecular}
						{#each molecularHandler.rows as reaction}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/biochemical/simple/{reaction.output.id}"
								onclick={rowClickHandler}
							>
								<td>{reaction.name}</td>
								<td class="isk">{formatNumber(reaction.input_total)}</td>
								<td class="isk">{formatNumber(reaction.taxes_total)}</td>
								<td class="isk">{formatNumber(reaction.output_total)}</td>
								<td class="isk">{formatNumber(reaction.profit)}</td>
								<td>{formatNumber(reaction.profit_per)} %</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>
