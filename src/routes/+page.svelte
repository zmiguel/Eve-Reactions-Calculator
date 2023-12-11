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
			<p class="lead mt-3">Drugs/Boosters</p>
			<p class="lead mt-3">
				<strong>Inputs:</strong> K-space gas + stuff<br /><strong>Outputs:</strong> boosters
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
			<p class="lead mt-3">T2 Materials</p>
			<p class="lead mt-3">
				<strong>Inputs:</strong> Moon goo<br /><strong>Outputs:</strong> T2 build materials
			</p>
			<a class="btn btn-primary" href="/composite" role="button">View Composite</a>
		</div>

		<div class="d-grid gap-2 col-lg-4 mx-auto">
			<img
				src="https://imageserver.eveonline.com/Type/45538_64.png"
				class="rounded mx-auto d-block"
				alt="Hybrid Reaction Icon"
			/>
			<h2 class="text-center mt-3">Hybrid Reactions</h2>
			<p class="lead mt-3">T3 Materials</p>
			<p class="lead mt-3">
				<strong>Inputs:</strong> J-space gas + stuff<br /><strong>Outputs:</strong> T3 build materials
			</p>
			<a class="btn btn-primary" href="/hybrid" role="button">View Hybrid</a>
		</div>
	</div>
</div>
