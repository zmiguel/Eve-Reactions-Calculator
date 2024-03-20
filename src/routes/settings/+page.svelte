<script>
	// noinspection ES6UnusedImports
	import Fa from 'svelte-fa';
	import { faHome } from '@fortawesome/free-solid-svg-icons';
	import AutoComplete from 'simple-svelte-autocomplete';
	import { systems } from '$lib/systems';

	export let data;
	let selected_system = data.system;
	let space_helper = data.space;
	let wormhole_helper = false;
	let wormhole_class = 'form-check form-check-inline';

	$: {
		wormhole_class = 'form-check form-check-inline';
		if (wormhole_helper && space_helper !== 'wormhole') {
			wormhole_class += ' bg-info';
		}
	}
</script>

<svelte:head>
	<title>Reaction Settings</title>
</svelte:head>

<div class="container">
	<div class="row">
		<div class="col-lg-8">
			<h4 class="">New Settings:</h4>
			<form class="mt-4" method="post">
				<fieldset class="form-group mb-3 row">
					<legend class="col-4 fs-6">Input Method</legend>
					<div class="col-8">
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="input"
								id="inputsell"
								value="sell"
								aria-describedby="inputHelpBlock"
								required
								checked={data.input === 'sell'}
							/>
							<label class="form-check-label" for="inputsell">Sell Order</label>
						</div>
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="input"
								id="inputbuy"
								value="buy"
								aria-describedby="inputHelpBlock"
								required
								checked={data.input === 'buy'}
							/>
							<label class="form-check-label" for="inputbuy">Buy Order</label>
						</div>
						<div id="inputHelpBlock" class="form-text text-muted">
							How you are getting your input materials?
						</div>
					</div>
				</fieldset>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">Input Market</legend>
					<div class="col-8">
						<select
							id="inMarket"
							name="inMarket"
							class="form-select w-25"
							aria-describedby="inMarketHelpBlock"
							required
						>
							{#each data.market_systems as system}
								<option value={system} selected={data.inMarket === system}>{system}</option>
							{/each}
						</select>
						<div id="inMarketHelpBlock" class="form-text text-muted">
							What system to use for inputs prices?
						</div>
					</div>
				</div>

				<fieldset class="form-group mb-3 row">
					<legend class="col-4 fs-6">Output Method</legend>
					<div class="col-8">
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="output"
								id="outputsell"
								value="sell"
								aria-describedby="outputHelpBlock"
								required
								checked={data.output === 'sell'}
							/>
							<label class="form-check-label" for="outputsell">Sell Order</label>
						</div>
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="output"
								id="outputbuy"
								value="buy"
								aria-describedby="outputHelpBlock"
								required
								checked={data.output === 'buy'}
							/>
							<label class="form-check-label" for="outputbuy">Buy Order</label>
						</div>
						<div id="outputHelpBlock" class="form-text text-muted">
							How you are selling your output materials?
						</div>
					</div>
				</fieldset>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">Output Market</legend>
					<div class="col-8">
						<select
							id="outMarket"
							name="outMarket"
							class="form-select w-25"
							aria-describedby="outMarketHelpBlock"
							required
						>
							{#each data.market_systems as system}
								<option value={system} selected={data.outMarket === system}>{system}</option>
							{/each}
						</select>
						<div id="outMarketHelpBlock" class="form-text text-muted">
							What system to use for output prices?
						</div>
					</div>
				</div>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">Broker's Fee</legend>
					<div class="col-8">
						<div class="input-group w-25">
							<input
								id="brokers"
								name="brokers"
								placeholder="3"
								type="number"
								step="0.01"
								value={data.brokers}
								class="form-control here"
								aria-describedby="brokerFeeHelpBlock"
								required
							/>
							<div class="input-group-text append">%</div>
						</div>
						<div id="brokerFeeHelpBlock" class="form-text text-muted">
							What's your broker fee % ?
						</div>
					</div>
				</div>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">Sales Tax</legend>
					<div class="col-8">
						<div class="input-group w-25">
							<input
								id="sales"
								name="sales"
								placeholder="5"
								type="number"
								step="0.01"
								value={data.sales}
								class="form-control here"
								aria-describedby="salesTaxHelpBlock"
								required
							/>
							<div class="input-group-text append">%</div>
						</div>
						<div id="salesTaxHelpBlock" class="form-text text-muted">What's your sales tax % ?</div>
					</div>
				</div>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">Reactions Skill Level</legend>
					<div class="col-8">
						<select
							id="skill"
							name="skill"
							class="form-select w-25"
							aria-describedby="skillHelpBlock"
							required
						>
							<option value="1" selected={data.skill === '1'}>1</option>
							<option value="2" selected={data.skill === '2'}>2</option>
							<option value="3" selected={data.skill === '3'}>3</option>
							<option value="4" selected={data.skill === '4'}>4</option>
							<option value="5" selected={data.skill === '5'}>5</option>
						</select>
						<div id="skillHelpBlock" class="form-text text-muted">
							What is your reactions skill level at?
						</div>
					</div>
				</div>

				<fieldset class="form-group mb-3 row">
					<legend class="col-4 fs-6">Facility Size</legend>
					<div class="col-8">
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="facility"
								id="facilitymedium"
								value="medium"
								aria-describedby="facilityHelpBlock"
								required
								checked={data.facility === 'medium'}
							/>
							<label class="form-check-label" for="facilitymedium">Medium</label>
						</div>
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="facility"
								id="facilitylarge"
								value="large"
								aria-describedby="facilityHelpBlock"
								required
								checked={data.facility === 'large'}
							/>
							<label class="form-check-label" for="facilitylarge">Large</label>
						</div>
						<div id="facilityHelpBlock" class="form-text text-muted">
							Are you using a med or large refinery?
						</div>
					</div>
				</fieldset>

				<fieldset class="form-group mb-3 row">
					<legend class="col-4 fs-6">Rigs Installed</legend>
					<div class="col-8">
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="rigs"
								id="rigsnone"
								value="0"
								aria-describedby="rigsHelpBlock"
								required
								checked={data.rigs === '0'}
							/>
							<label class="form-check-label" for="rigsnone">None</label>
						</div>
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="rigs"
								id="rigs1"
								value="1"
								aria-describedby="rigsHelpBlock"
								required
								checked={data.rigs === '1'}
							/>
							<label class="form-check-label" for="rigs1">Tech 1</label>
						</div>
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="rigs"
								id="rigs2"
								value="2"
								aria-describedby="rigsHelpBlock"
								required
								checked={data.rigs === '2'}
							/>
							<label class="form-check-label" for="rigs2">Tech 2</label>
						</div>
						<div id="rigsHelpBlock" class="form-text text-muted">
							Does your facility have any rigs for reactions?
						</div>
					</div>
				</fieldset>

				<fieldset class="form-group mb-3 row">
					<legend class="col-4 fs-6">Type of space</legend>
					<div class="col-8">
						<div class={wormhole_class}>
							<input
								class="form-check-input"
								type="radio"
								name="space"
								id="wormhole"
								value="wormhole"
								aria-describedby="spaceHelpBlock"
								required
								checked={data.space === 'wormhole'}
								on:click={() => (space_helper = 'wormhole')}
							/>
							<label class="form-check-label" for="wormhole">Wormhole</label>
						</div>
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="space"
								id="secnull"
								value="nullsec"
								aria-describedby="spaceHelpBlock"
								required
								checked={data.space === 'nullsec'}
								on:click={() => (space_helper = 'nullsec')}
							/>
							<label class="form-check-label" for="secnull">Nullsec</label>
						</div>
						<div class="form-check form-check-inline">
							<input
								class="form-check-input"
								type="radio"
								name="space"
								id="seclow"
								value="lowsec"
								aria-describedby="spaceHelpBlock"
								required
								checked={data.space === 'lowsec'}
								on:click={() => (space_helper = 'lowsec')}
							/>
							<label class="form-check-label" for="seclow">Lowsec</label>
						</div>
						<div id="spaceHelpBlock" class="form-text text-muted">
							Are you doing reactions in Nullsec, Lowsec or in a Wormhole??
						</div>
					</div>
				</fieldset>

				{#if space_helper === 'wormhole'}
					<div class="form-group mb-3 row">
						<legend class="col-4 fs-6">Manual Cost Index</legend>
						<div class="col-8">
							<div class="input-group w-25">
								<input
									id="costIndex"
									name="costIndex"
									placeholder="0"
									type="number"
									step="0.01"
									value={data.costIndex}
									class="form-control here"
									aria-describedby="costIndexHelpBlock"
									required
								/>
								<div class="input-group-text append">%</div>
							</div>
							<div id="costIndexHelpBlock" class="form-text text-muted">
								Cost index in your wormhole system?
							</div>
						</div>
					</div>
				{/if}

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">System</legend>
					<div class="col-8">
						<div class="input-group w-50">
							<div class="input-group-text" id="systemHelpBlock">
								<Fa icon={faHome} />
							</div>
							<AutoComplete
								hideArrow
								items={systems}
								id="system"
								name="system"
								placeholder="Ignoitton"
								class="form-control here"
								showClear="true"
								required
								bind:selectedItem={selected_system}
								onChange={() => {
									wormhole_helper = !!selected_system?.match(/J[0-9]{6}/);
								}}
							/>
						</div>
						<div id="systemHelpBlock" class="form-text text-muted">
							What system are you doing reactions in? used to calculate cost index.
						</div>
					</div>
				</div>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">Industry Tax</legend>
					<div class="col-8">
						<div class="input-group w-25">
							<input
								id="indyTax"
								name="indyTax"
								placeholder="0"
								type="number"
								step="0.01"
								value={data.tax}
								class="form-control here"
								aria-describedby="indyTaxHelpBlock"
								required
							/>
							<div class="input-group-text append">%</div>
						</div>
						<div id="indyTaxHelpBlock" class="form-text text-muted">
							What's your industry tax % ?
						</div>
					</div>
				</div>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">SCC Tax</legend>
					<div class="col-8">
						<div class="input-group w-25">
							<input
								id="sccTax"
								name="sccTax"
								placeholder="0"
								type="number"
								step="0.01"
								value={data.scc}
								class="form-control here"
								aria-describedby="sccTaxHelpBlock"
								required
							/>
							<div class="input-group-text append">%</div>
						</div>
						<div id="sccTaxHelpBlock" class="form-text text-muted">
							What's the current SCC tax % ?
						</div>
					</div>
				</div>

				<div class="form-group mb-3 row">
					<legend class="col-4 fs-6">Batch build time</legend>
					<div class="col-8">
						<div class="input-group w-50">
							<input
								id="duration"
								name="duration"
								placeholder="10080"
								type="number"
								value={data.duration}
								class="form-control here"
								aria-describedby="durationHelpBlock"
								required
							/>
							<div class="input-group-text append">Minutes</div>
						</div>
						<div id="durationHelpBlock" class="form-text text-muted">
							Time in minutes each of your jobs is going to run for (43200 = 30 days)
						</div>
					</div>
				</div>

				<div class="form-group row">
					<div class="offset-4 col-8">
						<button name="submit" type="submit" class="btn btn-primary">Save Settings</button>
					</div>
				</div>
			</form>
		</div>
		<div class="col-lg-4">
			<h4 class="">Current Settings:</h4>
			<table class="table table-sm table-bordered mt-4">
				<tbody>
					<tr>
						<th>In Method</th>
						<td>{data.input.charAt(0).toUpperCase() + data.input.slice(1)} Order</td>
					</tr>
					<tr>
						<th>In Market</th>
						<td>{data.inMarket}</td>
					</tr>
					<tr>
						<th>Out Method</th>
						<td>{data.output.charAt(0).toUpperCase() + data.output.slice(1)} Order</td>
					</tr>
					<tr>
						<th>Out Market</th>
						<td>{data.outMarket}</td>
					</tr>
					<tr>
						<th>Broker's Fee</th>
						<td>{data.brokers}</td>
					</tr>
					<tr>
						<th>Sales Tax</th>
						<td>{data.sales}</td>
					</tr>
					<tr>
						<th>Reactions</th>
						<td>Level {data.skill}</td>
					</tr>
					<tr>
						<th>Facility</th>
						<td>{data.facility.charAt(0).toUpperCase() + data.facility.slice(1)} Refinery</td>
					</tr>
					<tr>
						<th>Rig</th>
						<td>Tech {data.rigs} Rig</td>
					</tr>
					<tr>
						<th>Space</th>
						<td>{data.space.charAt(0).toUpperCase() + data.space.slice(1)}</td>
					</tr>
					{#if space_helper === 'wormhole'}
						<tr>
							<th>Cost Index</th>
							<td>{data.costIndex} %</td>
						</tr>
					{/if}
					<tr>
						<th>System</th>
						<td>{data.system.charAt(0).toUpperCase() + data.system.slice(1)}</td>
					</tr>
					<tr>
						<th>IndyTax</th>
						<td>{data.tax} %</td>
					</tr>
					<tr>
						<th>SCC Tax</th>
						<td>{data.scc} %</td>
					</tr>
					<tr>
						<th>Build Time</th>
						<td>{data.duration} Minutes</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</div>
