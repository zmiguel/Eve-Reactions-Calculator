<script>
	import { run } from 'svelte/legacy';

	import Fa from 'svelte-fa';
	import { faHome } from '@fortawesome/free-solid-svg-icons';
	import AutoComplete from 'simple-svelte-autocomplete';
	import { systems } from '$lib/systems';

	/**
	 * @typedef {Object} Props
	 * @property {string} [suffix]
	 * @property {any} settings
	 * @property {any} market_systems
	 * @property {any} space_helper
	 * @property {any} wormhole_helper
	 * @property {any} wormhole_class
	 * @property {any} selected_system
	 */

	/** @type {Props} */
	let {
		suffix = '',
		settings,
		market_systems,
		space_helper = $bindable(),
		wormhole_helper = $bindable(),
		wormhole_class = $bindable(),
		selected_system = $bindable()
	} = $props();

	// Add suffix to input names if it exists
	const getName = (base) => (suffix ? `${base}_${suffix}` : base);

	run(() => {
		wormhole_class = 'form-check form-check-inline';
		if (wormhole_helper && space_helper !== 'wormhole') {
			wormhole_class += ' bg-info';
		}
	});
</script>

<!-- Input Method -->
<fieldset class="form-group mb-3 row">
	<legend class="col-4 fs-6">Input Method</legend>
	<div class="col-8">
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('input')}
				id={getName('inputsell')}
				value="sell"
				aria-describedby="inputHelpBlock"
				required
				checked={settings.input === 'sell'}
			/>
			<label class="form-check-label" for={getName('inputsell')}>Sell Order</label>
		</div>
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('input')}
				id={getName('inputbuy')}
				value="buy"
				aria-describedby="inputHelpBlock"
				required
				checked={settings.input === 'buy'}
			/>
			<label class="form-check-label" for={getName('inputbuy')}>Buy Order</label>
		</div>
		<div id="inputHelpBlock" class="form-text text-muted">
			How you are getting your input materials?
		</div>
	</div>
</fieldset>

<!-- Input Market -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">Input Market</legend>
	<div class="col-8">
		<select
			id={getName('inMarket')}
			name={getName('inMarket')}
			class="form-select w-25"
			aria-describedby="inMarketHelpBlock"
			required
		>
			{#each market_systems as system}
				<option value={system} selected={settings.inMarket === system}>{system}</option>
			{/each}
		</select>
		<div id="inMarketHelpBlock" class="form-text text-muted">
			What system to use for inputs prices?
		</div>
	</div>
</div>

<!-- Output Method -->
<fieldset class="form-group mb-3 row">
	<legend class="col-4 fs-6">Output Method</legend>
	<div class="col-8">
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('output')}
				id={getName('outputsell')}
				value="sell"
				aria-describedby="outputHelpBlock"
				required
				checked={settings.output === 'sell'}
			/>
			<label class="form-check-label" for={getName('outputsell')}>Sell Order</label>
		</div>
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('output')}
				id={getName('outputbuy')}
				value="buy"
				aria-describedby="outputHelpBlock"
				required
				checked={settings.output === 'buy'}
			/>
			<label class="form-check-label" for={getName('outputbuy')}>Buy Order</label>
		</div>
		<div id="outputHelpBlock" class="form-text text-muted">
			How you are selling your output materials?
		</div>
	</div>
</fieldset>

<!-- Output Market -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">Output Market</legend>
	<div class="col-8">
		<select
			id={getName('outMarket')}
			name={getName('outMarket')}
			class="form-select w-25"
			aria-describedby="outMarketHelpBlock"
			required
		>
			{#each market_systems as system}
				<option value={system} selected={settings.outMarket === system}>{system}</option>
			{/each}
		</select>
		<div id="outMarketHelpBlock" class="form-text text-muted">
			What system to use for output prices?
		</div>
	</div>
</div>

<!-- Broker's Fee -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">Broker's Fee</legend>
	<div class="col-8">
		<div class="input-group w-25">
			<input
				id={getName('brokers')}
				name={getName('brokers')}
				placeholder="3"
				type="number"
				step="0.01"
				value={settings.brokers}
				class="form-control here"
				aria-describedby="brokerFeeHelpBlock"
				required
			/>
			<div class="input-group-text append">%</div>
		</div>
		<div id="brokerFeeHelpBlock" class="form-text text-muted">What's your broker fee % ?</div>
	</div>
</div>

<!-- Sales Tax -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">Sales Tax</legend>
	<div class="col-8">
		<div class="input-group w-25">
			<input
				id={getName('sales')}
				name={getName('sales')}
				placeholder="5"
				type="number"
				step="0.01"
				value={settings.sales}
				class="form-control here"
				aria-describedby="salesTaxHelpBlock"
				required
			/>
			<div class="input-group-text append">%</div>
		</div>
		<div id="salesTaxHelpBlock" class="form-text text-muted">What's your sales tax % ?</div>
	</div>
</div>

<!-- Reactions Skill Level -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">Reactions Skill Level</legend>
	<div class="col-8">
		<select
			id={getName('skill')}
			name={getName('skill')}
			class="form-select w-25"
			aria-describedby="skillHelpBlock"
			required
		>
			<option value="1" selected={settings.skill === '1'}>1</option>
			<option value="2" selected={settings.skill === '2'}>2</option>
			<option value="3" selected={settings.skill === '3'}>3</option>
			<option value="4" selected={settings.skill === '4'}>4</option>
			<option value="5" selected={settings.skill === '5'}>5</option>
		</select>
		<div id="skillHelpBlock" class="form-text text-muted">
			What is your reactions skill level at?
		</div>
	</div>
</div>

<!-- Facility Size -->
<fieldset class="form-group mb-3 row">
	<legend class="col-4 fs-6">Facility Size</legend>
	<div class="col-8">
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('facility')}
				id={getName('facilitymedium')}
				value="medium"
				aria-describedby="facilityHelpBlock"
				required
				checked={settings.facility === 'medium'}
			/>
			<label class="form-check-label" for={getName('facilitymedium')}>Medium</label>
		</div>
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('facility')}
				id={getName('facilitylarge')}
				value="large"
				aria-describedby="facilityHelpBlock"
				required
				checked={settings.facility === 'large'}
			/>
			<label class="form-check-label" for={getName('facilitylarge')}>Large</label>
		</div>
		<div id="facilityHelpBlock" class="form-text text-muted">
			Are you using a med or large refinery?
		</div>
	</div>
</fieldset>

<!-- Rigs Installed -->
<fieldset class="form-group mb-3 row">
	<legend class="col-4 fs-6">Rigs Installed</legend>
	<div class="col-8">
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('rigs')}
				id={getName('rigsnone')}
				value="0"
				aria-describedby="rigsHelpBlock"
				required
				checked={settings.rigs === '0'}
			/>
			<label class="form-check-label" for={getName('rigsnone')}>None</label>
		</div>
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('rigs')}
				id={getName('rigs1')}
				value="1"
				aria-describedby="rigsHelpBlock"
				required
				checked={settings.rigs === '1'}
			/>
			<label class="form-check-label" for={getName('rigs1')}>Tech 1</label>
		</div>
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('rigs')}
				id={getName('rigs2')}
				value="2"
				aria-describedby="rigsHelpBlock"
				required
				checked={settings.rigs === '2'}
			/>
			<label class="form-check-label" for={getName('rigs2')}>Tech 2</label>
		</div>
		<div id="rigsHelpBlock" class="form-text text-muted">
			Does your facility have any rigs for reactions?
		</div>
	</div>
</fieldset>

<!-- Type of space -->
<fieldset class="form-group mb-3 row">
	<legend class="col-4 fs-6">Type of space</legend>
	<div class="col-8">
		<div class={wormhole_class}>
			<input
				class="form-check-input"
				type="radio"
				name={getName('space')}
				id={getName('wormhole')}
				value="wormhole"
				aria-describedby="spaceHelpBlock"
				required
				checked={settings.space === 'wormhole'}
				onclick={() => (space_helper = 'wormhole')}
			/>
			<label class="form-check-label" for={getName('wormhole')}>Wormhole</label>
		</div>
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('space')}
				id={getName('secnull')}
				value="nullsec"
				aria-describedby="spaceHelpBlock"
				required
				checked={settings.space === 'nullsec'}
				onclick={() => (space_helper = 'nullsec')}
			/>
			<label class="form-check-label" for={getName('secnull')}>Nullsec</label>
		</div>
		<div class="form-check form-check-inline">
			<input
				class="form-check-input"
				type="radio"
				name={getName('space')}
				id={getName('seclow')}
				value="lowsec"
				aria-describedby="spaceHelpBlock"
				required
				checked={settings.space === 'lowsec'}
				onclick={() => (space_helper = 'lowsec')}
			/>
			<label class="form-check-label" for={getName('seclow')}>Lowsec</label>
		</div>
		<div id="spaceHelpBlock" class="form-text text-muted">
			Are you doing reactions in Nullsec, Lowsec or in a Wormhole??
		</div>
	</div>
</fieldset>

<!-- Manual Cost Index (if wormhole) -->
{#if space_helper === 'wormhole'}
	<div class="form-group mb-3 row">
		<legend class="col-4 fs-6">Manual Cost Index</legend>
		<div class="col-8">
			<div class="input-group w-25">
				<input
					id={getName('costIndex')}
					name={getName('costIndex')}
					placeholder="0"
					type="number"
					step="0.01"
					value={settings.costIndex}
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

<!-- System -->
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
				id={getName('system')}
				name={getName('system')}
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

<!-- Industry Tax -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">Industry Tax</legend>
	<div class="col-8">
		<div class="input-group w-25">
			<input
				id={getName('indyTax')}
				name={getName('indyTax')}
				placeholder="0"
				type="number"
				step="0.01"
				value={settings.tax}
				class="form-control here"
				aria-describedby="indyTaxHelpBlock"
				required
			/>
			<div class="input-group-text append">%</div>
		</div>
		<div id="indyTaxHelpBlock" class="form-text text-muted">What's your industry tax % ?</div>
	</div>
</div>

<!-- SCC Tax -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">SCC Tax</legend>
	<div class="col-8">
		<div class="input-group w-25">
			<input
				id={getName('sccTax')}
				name={getName('sccTax')}
				placeholder="0"
				type="number"
				step="0.01"
				value={settings.scc}
				class="form-control here"
				aria-describedby="sccTaxHelpBlock"
				required
			/>
			<div class="input-group-text append">%</div>
		</div>
		<div id="sccTaxHelpBlock" class="form-text text-muted">What's the current SCC tax % ?</div>
	</div>
</div>

<!-- Batch build time -->
<div class="form-group mb-3 row">
	<legend class="col-4 fs-6">Batch build time</legend>
	<div class="col-8">
		<div class="input-group w-50">
			<input
				id={getName('duration')}
				name={getName('duration')}
				placeholder="10080"
				type="number"
				value={settings.duration}
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
