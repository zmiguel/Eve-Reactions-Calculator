<script>
	import { TableHandler } from '@vincjo/datatables';
	import TH from '../TH.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let { data } = $props();

	const simpleHandler = new TableHandler(data.results.simple, { rowsPerPage: 50 });

	const complexHandler = new TableHandler(data.results.complex, { rowsPerPage: 50 });

	const chainHandler = new TableHandler(data.results.chain, { rowsPerPage: 50 });

	const unrefinedHandler = new TableHandler(data.results.unrefined, { rowsPerPage: 50 });

	const refinedHandler = new TableHandler(data.results.refined, { rowsPerPage: 50 });

	const eraticHandler = new TableHandler(data.results.eratic, { rowsPerPage: 50 });

	const eraticReproHandler = new TableHandler(data.results.eratic_repro, { rowsPerPage: 50 });

	const nFormat = new Intl.NumberFormat();

	/**
	 * @param {number | undefined} value - The number to format
	 * @returns {string} Formatted number or empty string if undefined
	 */
	function formatNumber(value) {
		return value !== undefined ? nFormat.format(value) : '0';
	}

	function rowClickHandler(e) {
		const href = resolve(e.currentTarget.dataset.href);
		if (e.ctrlKey || e.metaKey || e.button == 1) {
			window.open(href, '_blank');
		} else {
			goto(href);
		}
	}
</script>

<svelte:head>
	<title>Composite Reactions</title>
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
		<div class="card w-100 p-0" id="simple-reactions-card">
			<div class="card-header bg-info text-white fw-bold text-center w-100">Simple Reactions</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<tr>
						<TH handler={simpleHandler} orderBy="name">Reaction</TH>
						<TH handler={simpleHandler} orderBy="input_total">Inputs</TH>
						<TH handler={simpleHandler} orderBy="taxes_total">Tax</TH>
						<TH handler={simpleHandler} orderBy="output_total">Output</TH>
						<TH handler={simpleHandler} orderBy="profit">Profit</TH>
						<TH handler={simpleHandler} orderBy="profit_per">% prof.</TH>
					</tr>
				</thead>
				<tbody>
					{#if data.results.simple}
						{#each simpleHandler.rows as reaction (reaction.output.id)}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/composite/simple/{reaction.output.id}"
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

		<div class="card w-100 mt-4 p-0" id="complex-reactions-card">
			<div class="card-header bg-info text-white fw-bold text-center w-100">Complex Reactions</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<tr>
						<TH handler={complexHandler} orderBy="name">Reaction</TH>
						<TH handler={complexHandler} orderBy="input_total">Inputs</TH>
						<TH handler={complexHandler} orderBy="taxes_total">Tax</TH>
						<TH handler={complexHandler} orderBy="output_total">Output</TH>
						<TH handler={complexHandler} orderBy="profit">Profit</TH>
						<TH handler={complexHandler} orderBy="profit_per">% prof.</TH>
					</tr>
				</thead>
				<tbody>
					{#if data.results.complex}
						{#each complexHandler.rows as reaction (reaction.output.id)}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/composite/complex/{reaction.output.id}"
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

		<div class="card w-100 mt-4 p-0" id="chain-reactions-card">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Complex Chain Reactions
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<tr>
						<TH handler={chainHandler} orderBy="name">Reaction</TH>
						<TH handler={chainHandler} orderBy="input_total">Inputs</TH>
						<TH handler={chainHandler} orderBy="taxes_total">Tax</TH>
						<TH handler={chainHandler} orderBy="output_total">Output</TH>
						<TH handler={chainHandler} orderBy="profit">Profit</TH>
						<TH handler={chainHandler} orderBy="profit_per">% prof.</TH>
					</tr>
				</thead>
				<tbody>
					{#if data.results.chain}
						{#each chainHandler.rows as reaction (reaction.output.id)}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/composite/chain/{reaction.output.id}"
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

		<div class="card w-100 mt-4 p-0" id="unrefined-reactions-card">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Unrefined Reactions (not reprocessed)
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<tr>
						<TH handler={unrefinedHandler} orderBy="name">Reaction</TH>
						<TH handler={unrefinedHandler} orderBy="input_total">Inputs</TH>
						<TH handler={unrefinedHandler} orderBy="taxes_total">Tax</TH>
						<TH handler={unrefinedHandler} orderBy="output_total">Output</TH>
						<TH handler={unrefinedHandler} orderBy="profit">Profit</TH>
						<TH handler={unrefinedHandler} orderBy="profit_per">% prof.</TH>
					</tr>
				</thead>
				<tbody>
					{#if data.results.unrefined}
						{#each unrefinedHandler.rows as reaction (reaction.output.id)}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/composite/unrefined/{reaction.output.id}"
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

		<div class="card w-100 mt-4 p-0" id="refined-reactions-card">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Unrefined Reactions (55% Efficiency)
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<tr>
						<TH handler={refinedHandler} orderBy="name">Reaction</TH>
						<TH handler={refinedHandler} orderBy="input_total">Inputs</TH>
						<TH handler={refinedHandler} orderBy="taxes_total">Tax</TH>
						<TH handler={refinedHandler} orderBy="output_total">Output</TH>
						<TH handler={refinedHandler} orderBy="profit">Profit</TH>
						<TH handler={refinedHandler} orderBy="profit_per">% prof.</TH>
					</tr>
				</thead>
				<tbody>
					{#if data.results.refined}
						{#each refinedHandler.rows as reaction (reaction.intermediates.id)}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/composite/refined/{reaction.intermediates.id}"
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

		<div class="card w-100 mt-4 p-0" id="eratic-reactions-card">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Unrefined Mineral Reactions (no reprocessing)
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<tr>
						<TH handler={eraticHandler} orderBy="name">Reaction</TH>
						<TH handler={eraticHandler} orderBy="input_total">Inputs</TH>
						<TH handler={eraticHandler} orderBy="taxes_total">Tax</TH>
						<TH handler={eraticHandler} orderBy="output_total">Output</TH>
						<TH handler={eraticHandler} orderBy="profit">Profit</TH>
						<TH handler={eraticHandler} orderBy="profit_per">% prof.</TH>
					</tr>
				</thead>
				<tbody>
					{#if data.results.eratic}
						{#each eraticHandler.rows as reaction (reaction.id)}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/composite/eratic/{reaction.id}"
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

		<div class="card w-100 mt-4 p-0" id="eratic-repro-card">
			<div class="card-header bg-info text-white fw-bold text-center w-100">
				Unrefined Mineral Reactions (MAX Refine 90.63%)
			</div>
			<table width="100%" id="stab" class="table table-bordered text-center">
				<thead>
					<tr>
						<TH handler={eraticReproHandler} orderBy="name">Reaction</TH>
						<TH handler={eraticReproHandler} orderBy="input_total">Inputs</TH>
						<TH handler={eraticReproHandler} orderBy="taxes_total">Tax</TH>
						<TH handler={eraticReproHandler} orderBy="output_total">Output</TH>
						<TH handler={eraticReproHandler} orderBy="profit">Profit</TH>
						<TH handler={eraticReproHandler} orderBy="profit_per">% prof.</TH>
					</tr>
				</thead>
				<tbody>
					{#if data.results.eratic_repro}
						{#each eraticReproHandler.rows as reaction (reaction.id)}
							<tr
								class={'link-row ' + reaction.style}
								data-href="/composite/eratic-repro/{reaction.id}"
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
