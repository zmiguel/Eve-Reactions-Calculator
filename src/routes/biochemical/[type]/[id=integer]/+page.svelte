<script>
	export let data;

	const nFormat = new Intl.NumberFormat();
</script>

<svelte:head>
	<title>{data.results?.output.name} Reactions</title>
</svelte:head>

<div class="container">
	<div class="row mt-2">
		<h1 class="text-center w-100">{data.results?.output.name} Reaction</h1>
	</div>

	<div class="row mt-2">
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
		<form method="post" id="advsettings">
			<table class="table table-sm table-bordered text-center">
				<thead>
					<tr>
						<th># Runs per cycle</th>
						<th>Cycle time</th>
						<th>Total time</th>
						<th># Cycles</th>
						<th>Save</th>
					</tr>
				</thead>
				<tbody>
					<tr class="">
						<td
							><input
								id="cycles"
								form="advsettings"
								name="cycles"
								placeholder="50"
								type="number"
								min="1"
								max="300"
								value={data.cycles}
								class="here"
								aria-describedby="cyclesHelpBlock"
								required="required"
							/>
						</td>
						<td>{data.results?.cycle_data.cycle_time} Minutes</td>
						<td>{data.results?.cycle_data.total_time} Minutes</td>
						<td>{data.results?.cycle_data.num_cycles}</td>
						<td>
							<button name="submit" form="advsettings" type="submit" class="btn btn-sm btn-primary"
								>Save
							</button>
						</td>
					</tr>
				</tbody>
			</table>
		</form>
	</div>

	<div class="row mt-5">
		{#if data.results?.steps}
			<div class="col-4">
				<div class="card w-100">
					<div class="card-header bg-danger text-white text-center w-100 fw-bold">INPUTS</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Name</th>
								<th>Quantity</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							{#each data.results?.input as mat}
								<tr class="">
									<td>{mat.name}</td>
									<td>{mat.quantity}</td>
									<td class="isk">{nFormat.format(mat.price)}</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td colspan="2">TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.input_total)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
				<div class="card w-100 mt-4">
					<div class="card-header bg-danger text-white text-center w-100 fw-bold">TAXES</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Name</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							<tr class="">
								<td>Cost Index</td>
								<td class="isk">{nFormat.format(data.results?.taxes.system)}</td>
							</tr>
							<tr class="">
								<td>Facility Tax</td>
								<td class="isk">{nFormat.format(data.results?.taxes.facility)}</td>
							</tr>
							<tr class="">
								<td>SCC Tax</td>
								<td class="isk">{nFormat.format(data.results?.taxes.scc)}</td>
							</tr>
							<tr class="">
								<td>Market Tax Inputs</td>
								<td class="isk">{nFormat.format(data.results?.taxes.market.total.inputs)}</td>
							</tr>
							<tr class="">
								<td>Market Tax Output</td>
								<td class="isk">{nFormat.format(data.results?.taxes.market.total.output)}</td>
							</tr>
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td>TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.taxes_total)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>

			<div class="col-4">
				{#each data.results?.steps as step}
					<div class="card w-100 mb-4">
						<div class="card-header bg-warning text-white text-center w-100 fw-bold">
							INTERMEDIATE STEP {step.depth + 1}
						</div>
						{#each step.materials as mat}
							<div class="card w-100 rounded-0">
								<div class="card-header bg-warning-subtle text-center w-100 fw-bold rounded-0">
									{mat.output.name}
								</div>
								<table width="100%" class="table table-sm table-bordered text-center">
									<thead>
										<tr>
											<th>Name</th>
											<th>Quantity</th>
										</tr>
									</thead>
									<tbody>
										{#each mat.inputs as input}
											<tr class="">
												<td>{input.name}</td>
												<td>{input.quantity}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/each}
					</div>
				{/each}
			</div>

			<div class="col-4">
				<div class="card w-100">
					<div class="card-header bg-success text-white text-center w-100 fw-bold">OUTPUTS</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Name</th>
								<th>Quantity</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							<tr class="">
								<td>{data.results?.output.name}</td>
								<td>{data.results?.output.quantity}</td>
								<td class="isk">{nFormat.format(data.results?.output.price)}</td>
							</tr>
							{#if data.results?.remaining.length > 0}
								{#each data.results?.remaining as mat}
									<tr class="">
										<td>{mat.name}</td>
										<td>{mat.quantity}</td>
										<td>-</td>
									</tr>
								{/each}
							{/if}
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td colspan="2">TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.output.price)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
				<div class="card w-100 mt-4">
					<div class="card-header bg-info text-white text-center w-100 fw-bold">PROFIT REPORT</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Type</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							<tr class="">
								<td>Inputs</td>
								<td class="isk">{nFormat.format(data.results?.input_total)}</td>
							</tr>
							<tr class="">
								<td>Taxes</td>
								<td class="isk">{nFormat.format(data.results?.taxes_total)}</td>
							</tr>
							<tr class="">
								<td>Output</td>
								<td class="isk">{nFormat.format(data.results?.output.price)}</td>
							</tr>
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td>TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.profit)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
		{:else}
			<div class="col-6">
				<div class="card w-100">
					<div class="card-header bg-danger text-white text-center w-100 fw-bold">INPUTS</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Name</th>
								<th>Quantity</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							{#each data.results?.input as mat}
								<tr class="">
									<td>{mat.name}</td>
									<td>{mat.quantity}</td>
									<td class="isk">{nFormat.format(mat.price)}</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td colspan="2">TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.input_total)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
				<div class="card w-100 mt-4">
					<div class="card-header bg-danger text-white text-center w-100 fw-bold">TAXES</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Name</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							<tr class="">
								<td>Cost Index</td>
								<td class="isk">{nFormat.format(data.results?.taxes.system)}</td>
							</tr>
							<tr class="">
								<td>Facility Tax</td>
								<td class="isk">{nFormat.format(data.results?.taxes.facility)}</td>
							</tr>
							<tr class="">
								<td>SCC Tax</td>
								<td class="isk">{nFormat.format(data.results?.taxes.scc)}</td>
							</tr>
							<tr class="">
								<td>Market Tax Inputs</td>
								<td class="isk">{nFormat.format(data.results?.taxes.market.total.inputs)}</td>
							</tr>
							<tr class="">
								<td>Market Tax Output</td>
								<td class="isk">{nFormat.format(data.results?.taxes.market.total.output)}</td>
							</tr>
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td>TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.taxes_total)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
			<div class="col-6">
				<div class="card w-100">
					<div class="card-header bg-success text-white text-center w-100 fw-bold">OUTPUTS</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Name</th>
								<th>Quantity</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							<tr class="">
								<td>{data.results?.output.name}</td>
								<td>{data.results?.output.quantity}</td>
								<td class="isk">{nFormat.format(data.results?.output.price)}</td>
							</tr>
							{#if data.results?.remaining.length > 0}
								{#each data.results?.remaining as mat}
									<tr class="">
										<td>{mat.name}</td>
										<td>{mat.quantity}</td>
										<td>-</td>
									</tr>
								{/each}
							{/if}
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td colspan="2">TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.output.price)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
				<div class="card w-100 mt-4">
					<div class="card-header bg-info text-white text-center w-100 fw-bold">PROFIT REPORT</div>
					<table width="100%" class="table table-sm table-bordered text-center">
						<thead>
							<tr>
								<th>Type</th>
								<th>Price</th>
							</tr>
						</thead>
						<tbody>
							<tr class="">
								<td>Inputs</td>
								<td class="isk">{nFormat.format(data.results?.input_total)}</td>
							</tr>
							<tr class="">
								<td>Taxes</td>
								<td class="isk">{nFormat.format(data.results?.taxes_total)}</td>
							</tr>
							<tr class="">
								<td>Output</td>
								<td class="isk">{nFormat.format(data.results?.output.price)}</td>
							</tr>
						</tbody>
						<tfoot>
							<tr class="fw-bold">
								<td>TOTAL</td>
								<td class="isk">{nFormat.format(data.results?.profit)}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
		{/if}
	</div>
</div>
