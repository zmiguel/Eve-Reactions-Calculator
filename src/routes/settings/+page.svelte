<script>
	export let data;
	import SettingsForm from './SettingsForm.svelte';

	let settingsMode = data.settingsMode;

	let selected_system = data.settings.single.system;
	let space_helper = data.settings.single.space;
	let wormhole_helper = false;
	let wormhole_class = 'form-check form-check-inline';

    let activeTab;
    $: {
        // This will re-run whenever settingsMode changes
        activeTab = settingsMode === 'single' ? 'single' : 'biochemical';
    }

	// Get current settings based on active tab
	$: currentSettings = data.settings[activeTab];

	function handleTabClick(tab) {
		if (
			(settingsMode === 'single' && tab !== 'single') ||
			(settingsMode === 'separate' && tab === 'single')
		) {
			return;
		}
		activeTab = tab;
	}

	$: tabDisabled = (tab) =>
		(settingsMode === 'single' && tab !== 'single') ||
		(settingsMode === 'separate' && tab === 'single');

	// Update activeTab when changing modes
	$: if (settingsMode === 'separate' && activeTab === 'single') {
		activeTab = 'biochemical';
	}

    // Reactive update for settingsMode without form submission
    function handleSettingsModeChange() {
        if (settingsMode === 'single') {
            activeTab = 'single';
        } else {
            activeTab = 'biochemical';
        }
    }
</script>

<svelte:head>
	<title>Reaction Settings</title>
</svelte:head>

<div class="container">
	<div class="row">
		<div class="col-lg-8">
			<div class="d-flex justify-content-between align-items-center">
				<h4 class="mb-0">New Settings:</h4>
				<div class="col-sm-8 col-md-6 col-lg-5">
					<select
						class="form-select"
						bind:value={settingsMode}
						on:change={handleSettingsModeChange}
					>
						<option value="single">Single Settings Mode</option>
						<option value="separate">Separate Settings Mode</option>
					</select>
				</div>
			</div>

			<ul class="nav nav-tabs mt-4">
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'single' ? 'active' : ''}"
						on:click={() => handleTabClick('single')}
						disabled={tabDisabled('single')}
					>
						Single Settings
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'biochemical' ? 'active' : ''}"
						on:click={() => handleTabClick('biochemical')}
						disabled={tabDisabled('biochemical')}
					>
						Biochemical
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'composite' ? 'active' : ''}"
						on:click={() => handleTabClick('composite')}
						disabled={tabDisabled('composite')}
					>
						Composite
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'hybrid' ? 'active' : ''}"
						on:click={() => handleTabClick('hybrid')}
						disabled={tabDisabled('hybrid')}
					>
						Hybrid
					</button>
				</li>
			</ul>

			<form class="mt-4" method="post">
				<input type="hidden" name="settingsMode" value={settingsMode} />

				{#if activeTab === 'single'}
					<div class="tab-content">
						<SettingsForm
							settings={currentSettings}
							market_systems={data.market_systems}
							{space_helper}
							{wormhole_helper}
							{wormhole_class}
							{selected_system}
						/>
					</div>
				{:else if activeTab === 'biochemical'}
					<div class="tab-content">
						<SettingsForm
							suffix="biochemical"
							settings={currentSettings}
							market_systems={data.market_systems}
							{space_helper}
							{wormhole_helper}
							{wormhole_class}
							{selected_system}
						/>
					</div>
				{:else if activeTab === 'composite'}
					<div class="tab-content">
						<SettingsForm
							suffix="composite"
							settings={currentSettings}
							market_systems={data.market_systems}
							{space_helper}
							{wormhole_helper}
							{wormhole_class}
							{selected_system}
						/>
					</div>
				{:else if activeTab === 'hybrid'}
					<div class="tab-content">
						<SettingsForm
							suffix="hybrid"
							settings={currentSettings}
							market_systems={data.market_systems}
							{space_helper}
							{wormhole_helper}
							{wormhole_class}
							{selected_system}
						/>
					</div>
				{/if}

				<div class="form-group row mt-4">
					<div class="offset-4 col-8">
						<button type="submit" class="btn btn-primary">Save All Settings</button>
					</div>
				</div>
			</form>
		</div>

		<div class="col-lg-4">
			<h4 class="">Current Settings:</h4>
			<!-- Add tabs for current settings display -->
			<ul class="nav nav-tabs mt-4">
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'single' ? 'active' : ''}"
						on:click={() => handleTabClick('single')}
						disabled={tabDisabled('single')}
					>
						Single
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'biochemical' ? 'active' : ''}"
						on:click={() => handleTabClick('biochemical')}
						disabled={tabDisabled('biochemical')}
					>
						Bio
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'composite' ? 'active' : ''}"
						on:click={() => handleTabClick('composite')}
						disabled={tabDisabled('composite')}
					>
						Comp
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link {activeTab === 'hybrid' ? 'active' : ''}"
						on:click={() => handleTabClick('hybrid')}
						disabled={tabDisabled('hybrid')}
					>
						Hybrid
					</button>
				</li>
			</ul>

			{#if ['single', 'biochemical', 'composite', 'hybrid'].includes(activeTab)}
				<table class="table table-sm table-bordered mt-4">
					<tbody>
						<tr>
							<th>In Method</th>
							<td
								>{currentSettings.input?.charAt(0).toUpperCase() + currentSettings.input?.slice(1)} Order</td
							>
						</tr>
						<tr>
							<th>In Market</th>
							<td>{currentSettings.inMarket}</td>
						</tr>
						<tr>
							<th>Out Method</th>
							<td
								>{currentSettings.output?.charAt(0).toUpperCase() +
									currentSettings.output?.slice(1)} Order</td
							>
						</tr>
						<tr>
							<th>Out Market</th>
							<td>{currentSettings.outMarket}</td>
						</tr>
						<tr>
							<th>Broker's Fee</th>
							<td>{currentSettings.brokers}</td>
						</tr>
						<tr>
							<th>Sales Tax</th>
							<td>{currentSettings.sales}</td>
						</tr>
						<tr>
							<th>Reactions</th>
							<td>Level {currentSettings.skill}</td>
						</tr>
						<tr>
							<th>Facility</th>
							<td
								>{currentSettings.facility?.charAt(0).toUpperCase() +
									currentSettings.facility?.slice(1)} Refinery</td
							>
						</tr>
						<tr>
							<th>Rig</th>
							<td>Tech {currentSettings.rigs} Rig</td>
						</tr>
						<tr>
							<th>Space</th>
							<td
								>{currentSettings.space?.charAt(0).toUpperCase() +
									currentSettings.space?.slice(1)}</td
							>
						</tr>
						{#if space_helper === 'wormhole'}
							<tr>
								<th>Cost Index</th>
								<td>{currentSettings.costIndex} %</td>
							</tr>
						{/if}
						<tr>
							<th>System</th>
							<td
								>{currentSettings.system?.charAt(0).toUpperCase() +
									currentSettings.system?.slice(1)}</td
							>
						</tr>
						<tr>
							<th>IndyTax</th>
							<td>{currentSettings.tax} %</td>
						</tr>
						<tr>
							<th>SCC Tax</th>
							<td>{currentSettings.scc} %</td>
						</tr>
						<tr>
							<th>Build Time</th>
							<td>{currentSettings.duration} Minutes</td>
						</tr>
					</tbody>
				</table>
			{/if}
		</div>
	</div>
</div>
