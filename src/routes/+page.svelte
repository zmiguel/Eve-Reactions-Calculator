<svelte:head>
	<title>EVE Online Reactions Calculator</title>
</svelte:head>

<div class="container">
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
			<a class="btn btn-primary" href="/biochemical" role="button">View Biochemical</a>
		</div>

		<div class="d-grid gap-2 col-lg-4 mx-auto">
			<img
				src="https://imageserver.eveonline.com/Type/45537_64.png"
				class="rounded mx-auto d-block"
				alt="Composite Reaction Icon"
			/>
			<h2 class="text-center mt-3">Composite Reactions</h2>
			<p class="lead mt-3">Ship Materials</p>
			<p class="lead mt-3">
				<strong>Inputs:</strong> Moon goo<br /><strong>Outputs:</strong> T2 Ship Materials + Other
			</p>
			<a class="btn btn-primary" href="/composite" role="button">View Composite</a>
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
				<strong>Inputs:</strong> J-space gas + minerals<br /><strong>Outputs:</strong> T3 Ship Materials + Other
			</p>
			<a class="btn btn-primary" href="/hybrid" role="button">View Hybrid</a>
		</div>
	</div>
</div>
