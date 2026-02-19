<script>
	import { onMount } from 'svelte';

	onMount(async () => {
		await import('swagger-ui-dist/swagger-ui.css');
		const swaggerModule = await import('swagger-ui-dist/swagger-ui-es-bundle.js');
		const SwaggerUIBundle = swaggerModule.default;

		if (SwaggerUIBundle) {
			SwaggerUIBundle({
				url: '/api/v1/openapi.json',
				dom_id: '#swagger-ui',
				docExpansion: 'list',
				deepLinking: true,
				persistAuthorization: true
			});
		}
	});
</script>

<svelte:head>
	<title>OpenAPI Explorer - EVE Reactions Calculator</title>
</svelte:head>

<div class="container mt-4 mb-5">
	<div class="row">
		<div class="col-12">
			<div id="swagger-ui"></div>
		</div>
	</div>
</div>
