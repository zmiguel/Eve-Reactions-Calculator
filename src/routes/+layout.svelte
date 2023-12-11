<script>
	import '../app.scss';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	onMount(() => {
		import('bootstrap/dist/js/bootstrap.bundle.min.js');
	});
</script>

<svelte:head>
	<!-- Google tag (gtag.js) -->
	<script async src="https://www.googletagmanager.com/gtag/js?id=G-MZK5Y3B3KH"></script>
	<script>
		window.dataLayer = window.dataLayer || [];
		function gtag(){dataLayer.push(arguments);}
		gtag('js', new Date());

		gtag('config', 'G-MZK5Y3B3KH');
	</script>
	<meta charset="UTF-8" />
	<meta
		name="description"
		content="EVE Online Reactions profit calculator for the POST-Lifeblood era"
	/>
	<meta name="keywords" content="eve,reactions,lifeblood,profit,money,isk" />
	<meta name="author" content="Oxed G" />
	<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=Gvk4J866v5" />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=Gvk4J866v5" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=Gvk4J866v5" />
	<link rel="manifest" href="/site.webmanifest?v=Gvk4J866v5" />
	<link rel="mask-icon" href="/safari-pinned-tab.svg?v=Gvk4J866v5" color="#5bbad5" />
	<link rel="shortcut icon" href="/favicon.ico?v=Gvk4J866v5" />
	<meta name="msapplication-TileColor" content="#b91d47" />
	<meta name="msapplication-TileImage" content="/mstile-144x144.png?v=Gvk4J866v5" />
	<meta name="theme-color" content="#ffffff" />

	<link href="https://fonts.cdnfonts.com/css/helvetica-255" rel="stylesheet" />
</svelte:head>

<nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top" data-bs-theme="dark">
	<div class="container">
		<a class="navbar-brand" href="/">EVE Online Reactions Calculator</a>
		<button
			class="navbar-toggler"
			type="button"
			data-toggle="collapse"
			data-target="#navbarResponsive"
			aria-controls="navbarResponsive"
			aria-expanded="false"
			aria-label="Toggle navigation"
		>
			<span class="navbar-toggler-icon" />
		</button>
		<div class="collapse navbar-collapse" id="navbarResponsive">
			<ul class="navbar-nav ms-auto">
				<li class="nav-item">
					<a class="nav-link" href="/" class:active={$page.url.pathname === '/'}>Home</a>
				</li>
				<li class="nav-item">
					<a
						class="nav-link"
						href="/biochemical"
						class:active={$page.url.pathname === '/biochemical'}>Biochemical</a
					>
				</li>
				<li class="nav-item">
					<a class="nav-link" href="/composite" class:active={$page.url.pathname === '/composite'}
						>Composite</a
					>
				</li>
				<li class="nav-item">
					<a class="nav-link" href="/hybrid" class:active={$page.url.pathname === '/hybrid'}
						>Hybrid</a
					>
				</li>
				<li class="nav-item">
					<a class="nav-link" href="/settings" class:active={$page.url.pathname === '/settings'}
						>Settings</a
					>
				</li>
				<li class="nav-item">
					<a
						class="nav-link patreon"
						href="https://www.patreon.com/EVEReactionsCalculator"
						target="_blank">Patreon</a
					>
				</li>
			</ul>
		</div>
	</div>
</nav>

<slot />

<div
	class="modal fade"
	id="copyrightModal"
	tabindex="-1"
	aria-labelledby="copyrightModalLabel"
	aria-hidden="true"
>
	<div class="modal-dialog modal-dialog-centered modal-lg">
		<div class="modal-content">
			<div class="modal-header">
				<h1 class="modal-title fs-5" id="copyrightModalLabel">CCP Copyright Notice</h1>
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" />
			</div>
			<div class="modal-body">
				<p>
					EVE Online and the EVE logo are the registered trademarks of CCP hf. All rights are
					reserved worldwide.
				</p>
				<p>
					All other trademarks are the property of their respective owners. EVE Online, the EVE
					logo, EVE and all associated logos and designs are the intellectual property of CCP hf.
					All artwork, screenshots, characters, vehicles, storylines, world facts or other
					recognizable features of the intellectual property relating to these trademarks are
					likewise the intellectual property of CCP hf. CCP hf. has granted permission to EVE
					Reactions Calculator to use EVE Online and all associated logos and designs for
					promotional and information purposes on its website but does not endorse, and is not in
					any way affiliated with, EVE Reactions Calculator.
				</p>
				<p>
					CCP is in no way responsible for the content on or functioning of this website, nor can it
					be liable for any damage arising from the use of this website.
				</p>
			</div>
		</div>
	</div>
</div>

<footer class="footer bg-dark" data-bs-theme="dark">
	<div class="container">
		<div class="row">
			<div class="col">
				<span class="text-body-secondary"
					>If this service has helped you, please consider donating some ISK to <strong
						>Oxed G</strong
					>
					- Thanks! |
					<a href="https://www.patreon.com/EVEReactionsCalculator" target="_blank">Patreon</a></span
				>
			</div>
			<div class="col-4 d-grid gap-2 d-md-flex justify-content-md-end p-0">
				<button
					type="button"
					class="btn btn-link text-body-secondary text-end p-0"
					data-bs-toggle="modal"
					data-bs-target="#copyrightModal"
				>
					CCP Copyright Notice
				</button>
			</div>
		</div>
	</div>
</footer>
