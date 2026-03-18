<script>
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>EVE Online Reactions Calculator</title>
</svelte:head>

<div class="container">
	<div class="row mt-5">
		<div class="col-12">
			<div class="alert alert-success border-0 shadow-sm d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3 px-4 py-3 mb-0" role="alert">
				<div>
					<h1 class="h4 mb-1">New Market History API</h1>
					<p class="mb-0">Power your tools with historical EVE market data. 1:1 Mokaam replacement, Google Sheets & more!</p>
				</div>
				<a class="btn btn-primary" href="https://market.coalition.space" target="_blank" rel="noopener">
					Visit Market.Coalition.Space!
				</a>
			</div>
		</div>
	</div>
	<div class="row mt-5">
		<div class="d-grid gap-2 col-lg-4 mx-auto">
			<img
				src="https://imageserver.eveonline.com/Type/45539_64.png"
				class="rounded mx-auto d-block"
				alt="Biochemical Reaction Icon"
			/>
			<h2 class="text-center mt-3">Biochemical Reactions</h2>
			<p class="lead mt-3">Boosters + Molecular-Forged items</p>
			<p class="lead mt-3">
				<strong>Inputs:</strong> K-space gas + minerals<br /><strong>Outputs:</strong> Boosters + Molecular-Forged
			</p>
			<a class="btn btn-primary" href={resolve('/biochemical')} role="button">View Biochemical</a>
		</div>

		<div class="d-grid gap-2 col-lg-4 mx-auto">
			<img
				src="https://imageserver.eveonline.com/Type/45537_64.png"
				class="rounded mx-auto d-block"
				alt="Composite Reaction Icon"
			/>
			<h2 class="text-center mt-3">Composite Reactions</h2>
			<p class="lead mt-3">Ship Materials + Unrefined Minerals</p>
			<p class="lead mt-3">
				<strong>Inputs:</strong> Moon goo + Prismaticite<br /><strong>Outputs:</strong> T2 Ship Materials
				+ Unrefined Minerals & Others
			</p>
			<a class="btn btn-primary" href={resolve('/composite')} role="button">View Composite</a>
		</div>

		<div class="d-grid gap-2 col-lg-4 mx-auto">
			<img
				src="https://imageserver.eveonline.com/Type/45538_64.png"
				class="rounded mx-auto d-block"
				alt="Hybrid Reaction Icon"
			/>
			<h2 class="text-center mt-3">Hybrid Polymer Reactions</h2>
			<p class="lead mt-3">Ship Materials & Booster Components</p>
			<p class="lead mt-3">
				<strong>Inputs:</strong> J-space gas + minerals<br /><strong>Outputs:</strong> T3 Ship Materials
				+ Other
			</p>
			<a class="btn btn-primary" href={resolve('/hybrid')} role="button">View Hybrid</a>
		</div>
	</div>
</div>
