<script>
	import { resolve } from '$app/paths';

	const baseUrl = 'https://reactions.coalition.space/api/v1';

	const endpoints = [
		{
			name: 'Biochemical',
			path: '/biochemical/[type]/[id]',
			types: [
				'synth',
				'standard',
				'improved',
				'improved_chain',
				'strong',
				'strong_chain',
				'molecular'
			],
			notes:
				'improved_chain requires an improved blueprint id. strong_chain requires a strong blueprint id.'
		},
		{
			name: 'Composite',
			path: '/composite/[type]/[id]',
			types: ['simple', 'complex', 'chain', 'unrefined', 'refined', 'eratic', 'eratic-repro'],
			notes: 'chain requires a complex blueprint id. refined requires an unrefined blueprint id.'
		},
		{
			name: 'Hybrid',
			path: '/hybrid/[id]',
			types: ['hybrid'],
			notes: 'No [type] segment in the path for hybrid.'
		}
	];

	const params = [
		{
			key: 'inMarket',
			type: 'string',
			required: 'yes',
			values: 'Any tracked market system (e.g. Jita, Amarr, Perimeter)',
			notes: 'Input market system name'
		},
		{
			key: 'outMarket',
			type: 'string',
			required: 'yes',
			values: 'Any tracked market system',
			notes: 'Output market system name'
		},
		{
			key: 'system',
			type: 'string',
			required: 'yes',
			values: 'Reaction system name (e.g. Ignoitton)',
			notes: 'System used for cost index lookup'
		},
		{
			key: 'input',
			type: 'enum',
			required: 'yes',
			values: 'buy | sell',
			notes: 'Input pricing mode'
		},
		{
			key: 'output',
			type: 'enum',
			required: 'yes',
			values: 'buy | sell',
			notes: 'Output pricing mode'
		},
		{
			key: 'brokers',
			type: 'number',
			required: 'yes',
			values: '0 to 10',
			notes: 'Broker fee percentage'
		},
		{
			key: 'sales',
			type: 'number',
			required: 'yes',
			values: '0 to 8',
			notes: 'Sales tax percentage'
		},
		{
			key: 'skill',
			type: 'enum',
			required: 'yes',
			values: '1 | 2 | 3 | 4 | 5',
			notes: 'Reactions skill level'
		},
		{
			key: 'facility',
			type: 'enum',
			required: 'yes',
			values: 'medium | large',
			notes: 'Refinery size'
		},
		{ key: 'rigs', type: 'enum', required: 'yes', values: '0 | 1 | 2', notes: 'Rig tier' },
		{
			key: 'space',
			type: 'enum',
			required: 'yes',
			values: 'nullsec | lowsec | wormhole',
			notes: 'Space type'
		},
		{
			key: 'tax',
			type: 'number',
			required: 'yes',
			values: '0 to 100',
			notes: 'Industry tax percentage'
		},
		{
			key: 'scc',
			type: 'number',
			required: 'yes',
			values: '0 to 100',
			notes: 'SCC surcharge percentage'
		},
		{
			key: 'duration',
			type: 'integer',
			required: 'yes',
			values: '1 to 43200 (minutes)',
			notes: 'Job duration in minutes'
		},
		{
			key: 'cycles',
			type: 'integer',
			required: 'yes',
			values: '1 to 100000',
			notes: 'Cycle count'
		},
		{
			key: 'costIndex',
			type: 'number',
			required: 'yes',
			values: '0 to 100',
			notes: 'Manual cost index (primarily for wormhole workflows)'
		},
		{
			key: 'prismaticite',
			type: 'number',
			required: 'yes',
			values: '0 to 100',
			notes: 'Prismaticite luck percentage'
		}
	];

	const sharedQuery =
		'inMarket=Jita&outMarket=Jita&system=Ignoitton&input=buy&output=sell&brokers=3&sales=3.6&skill=5&facility=large&rigs=2&space=nullsec&tax=1&scc=4&duration=10080&cycles=50&costIndex=0&prismaticite=50';

	const getExample = `curl "${baseUrl}/hybrid/30306?${sharedQuery}"`;
	const getExampleNoMeta = `curl "${baseUrl}/hybrid/30306?${sharedQuery}&includeMeta=false"`;
	const openApiExample = `curl "${baseUrl}/openapi.json"`;

	const postBiochemical = `curl -X POST "${baseUrl}/biochemical/improved_chain/28686" \\
	-H "Content-Type: application/json" \\
	-d '{
		"inMarket": "Jita",
		"outMarket": "Jita",
		"system": "Ignoitton",
		"input": "buy",
		"output": "sell",
		"brokers": "3",
		"sales": "3.6",
		"skill": "5",
		"facility": "large",
		"rigs": "2",
		"space": "nullsec",
		"indyTax": "1",
		"sccTax": "4",
		"duration": "10080",
		"cycles": "50",
		"costIndex": "0",
		"prismaticite": "50"
	}'`;

	const postComposite = `curl -X POST "${baseUrl}/composite/refined/57475" \\
	-H "Content-Type: application/json" \\
	-d '{
		"inMarket": "Jita",
		"outMarket": "Jita",
		"system": "Ignoitton",
		"input": "buy",
		"output": "sell",
		"brokers": "3",
		"sales": "3.6",
		"skill": "5",
		"facility": "large",
		"rigs": "2",
		"space": "wormhole",
		"tax": "1",
		"scc": "4",
		"duration": "10080",
		"cycles": "50",
		"costIndex": "4.5",
		"prismaticite": "50"
	}'`;

	const successExample = `{
	"meta": {
		"version": "v1",
		"calculator": "hybrid",
		"type": "hybrid",
		"itemId": 30306,
		"count": 1,
		"timestamp": "2026-02-19T20:15:10.823Z",
		"params": {
			"inMarket": "Jita",
			"outMarket": "Jita",
			"system": "Ignoitton",
			"input": "buy",
			"output": "sell",
			"brokers": "3",
			"sales": "3.6",
			"skill": "5",
			"facility": "large",
			"rigs": "2",
			"space": "nullsec",
			"tax": "1",
			"scc": "4",
			"duration": "10080",
			"cycles": "50",
			"costIndex": "0",
			"prismaticite": "50"
		}
	},
	"results": [
		{
			"name": "Example Reaction",
			"profit": 1234567.89,
			"profit_per": 14.23
		}
	]
}`;

	const errorExample = `{
	"error": "Invalid value for space: 'highsec'. Allowed values: nullsec, lowsec, wormhole",
	"code": "INVALID_VALUE",
	"details": {
		"key": "space",
		"allowed": ["nullsec", "lowsec", "wormhole"],
		"value": "highsec"
	}
}`;
</script>

<svelte:head>
	<title>API Documentation - EVE Reactions Calculator</title>
</svelte:head>

<div class="container mt-5 mb-5">
	<div class="row">
		<div class="col-12">
			<h1 class="mb-4">API Documentation</h1>
			<p class="lead">
				Use the same calculation engine as the web calculators for one specific reaction item per
				request.
			</p>
			<div class="alert alert-info">
				<strong>Base URL:</strong> <code>{baseUrl}</code>
			</div>
			<div class="alert alert-secondary mb-0">
				<strong>Request model:</strong>
				Provide every required settings parameter. GET uses query string. POST accepts query + JSON body
				(JSON values override query values).
			</div>
			<div class="alert alert-secondary mt-3 mb-0">
				<strong>OpenAPI schema:</strong> <code>{baseUrl}/openapi.json</code>
			</div>
			<div class="alert alert-success mt-3 mb-0">
				<strong>Interactive explorer:</strong>
				<a href={resolve('/api/openapi')} class="alert-link">Open Swagger UI</a>
			</div>
		</div>
	</div>

	<hr class="my-5" />

	<div class="row">
		<div class="col-lg-12">
			<h2>Endpoints</h2>
			<p>All endpoints support <code>GET</code> and <code>POST</code>.</p>

			{#each endpoints as endpoint (endpoint.name)}
				<div class="card bg-dark text-white mb-4">
					<div class="card-header border-secondary">
						<h5 class="mb-0">{endpoint.name}</h5>
					</div>
					<div class="card-body">
						<p class="mb-2"><code>{endpoint.path}</code></p>
						<p class="mb-2">
							<strong>Allowed types:</strong>
							{endpoint.types.join(', ')}
						</p>
						<p class="mb-0"><strong>Type rules:</strong> {endpoint.notes}</p>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<hr class="my-5" />

	<div class="row">
		<div class="col-12">
			<h2>Required Parameters</h2>
			<p>
				All parameters below are required on every request. This includes values that are only
				actively used in certain scenarios (for example <code>costIndex</code> outside wormhole mode).
			</p>

			<div class="table-responsive">
				<table class="table table-striped table-hover table-bordered">
					<thead class="table-dark">
						<tr>
							<th>Key</th>
							<th>Type</th>
							<th>Required</th>
							<th>Valid values</th>
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{#each params as row (row.key)}
							<tr>
								<td><code>{row.key}</code></td>
								<td>{row.type}</td>
								<td>{row.required}</td>
								<td>{row.values}</td>
								<td>{row.notes}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="alert alert-warning mt-3 mb-0">
				<strong>Alias support:</strong> You can send <code>indyTax</code> instead of
				<code>tax</code> and <code>sccTax</code> instead of <code>scc</code>. You can also send
				<code>includeMeta=false</code>
				(query or JSON) to return only
				<code>results</code>.
			</div>
		</div>
	</div>

	<hr class="my-5" />

	<div class="row">
		<div class="col-12">
			<h2>Examples</h2>

			<h4 class="mt-4">1. GET (query string)</h4>
			<p>Great for spreadsheets or quick URL-driven integrations.</p>
			<div class="card bg-dark text-white">
				<div class="card-body">
					<pre class="m-0"><code>{getExample}</code></pre>
				</div>
			</div>

			<h4 class="mt-4">2. POST (biochemical, chain)</h4>
			<p>Example shows supported aliases (<code>indyTax</code>, <code>sccTax</code>).</p>
			<div class="card bg-dark text-white">
				<div class="card-body">
					<pre class="m-0"><code>{postBiochemical}</code></pre>
				</div>
			</div>

			<h4 class="mt-4">3. POST (composite, refined)</h4>
			<div class="card bg-dark text-white">
				<div class="card-body">
					<pre class="m-0"><code>{postComposite}</code></pre>
				</div>
			</div>

			<h4 class="mt-4">4. Success response shape</h4>
			<div class="card bg-dark text-white">
				<div class="card-body">
					<pre class="m-0"><code>{successExample}</code></pre>
				</div>
			</div>

			<h4 class="mt-4">5. Error response example (400)</h4>
			<div class="card bg-dark text-white">
				<div class="card-body">
					<pre class="m-0"><code>{errorExample}</code></pre>
				</div>
			</div>

			<h4 class="mt-4">6. GET without meta (spreadsheet-friendly)</h4>
			<div class="card bg-dark text-white">
				<div class="card-body">
					<pre class="m-0"><code>{getExampleNoMeta}</code></pre>
				</div>
			</div>

			<h4 class="mt-4">7. OpenAPI schema</h4>
			<div class="card bg-dark text-white">
				<div class="card-body">
					<pre class="m-0"><code>{openApiExample}</code></pre>
				</div>
			</div>
		</div>
	</div>

	<hr class="my-5" />

	<div class="row">
		<div class="col-12">
			<h2>Status Codes</h2>
			<ul>
				<li><code>200</code> - Successful calculation</li>
				<li>
					<code>400</code> - Missing/invalid request parameters, invalid type, invalid id/type combination
				</li>
				<li><code>404</code> - Blueprint id not found in that calculator group</li>
				<li><code>413</code> - Request body exceeds size limit</li>
				<li><code>429</code> - Rate limit exceeded</li>
				<li><code>500</code> - Internal server or unavailable platform bindings/data</li>
			</ul>

			<h3 class="mt-4">Error Codes</h3>
			<p class="mb-2">
				Every non-200 response includes a machine-readable <code>code</code> field.
			</p>
			<ul>
				<li><code>MISSING_PARAMS</code>, <code>INVALID_JSON</code>, <code>INVALID_BODY</code></li>
				<li>
					<code>INVALID_VALUE</code>, <code>INVALID_NUMBER</code>, <code>INVALID_INTEGER</code>,
					<code>INVALID_RANGE</code>
				</li>
				<li>
					<code>INVALID_ITEM_ID</code>, <code>INVALID_TYPE</code>, <code>TYPE_ID_MISMATCH</code>
				</li>
				<li>
					<code>BLUEPRINT_NOT_FOUND</code>, <code>ENV_UNAVAILABLE</code>,
					<code>INTERNAL_ERROR</code>
				</li>
				<li><code>PAYLOAD_TOO_LARGE</code>, <code>RATE_LIMITED</code></li>
			</ul>

			<h3 class="mt-4">Guardrails</h3>
			<ul>
				<li><strong>Body size:</strong> POST requests are limited to <code>16 KB</code>.</li>
				<li>
					<strong>Rate limit:</strong> approximately <code>90 requests / 60 seconds</code> per IP and
					endpoint path.
				</li>
			</ul>
		</div>
	</div>
</div>
