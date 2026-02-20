<script>
	import '../app.scss';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let { data, children } = $props();

	onMount(() => {
		import('bootstrap/dist/js/bootstrap.bundle.min.js').then((bootstrap) => {
			// Bootstrap JS loaded
			console.log('Bootstrap JS loaded');
			if (data.partner === false) {
				let modalElement = document.getElementById('partnerModal');
				let modalInstance = new bootstrap.Modal(modalElement);
				modalInstance.show();
			}
		});
	});
</script>

<svelte:head>
	<script async src="https://www.googletagmanager.com/gtag/js?id=G-MZK5Y3B3KH"></script>
	<script>
		window.dataLayer = window.dataLayer || [];
		function gtag() {
			dataLayer.push(arguments);
		}
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
		<div class="d-flex align-items-center gap-2 flex-grow-1 overflow-hidden me-2">
			<a class="navbar-brand mb-0 text-truncate fs-6" href={resolve('/')}>
				EVE Online Reactions Calculator
			</a>
			<a
				class="btn btn-sm btn-secondary fw-semibold py-0 px-2 small d-none d-lg-inline-block"
				href="https://d-scan.space"
				target="_blank"
				rel="noopener"
				aria-label="Try D-Scan.Space in a new tab"
			>
				Try D-Scan.Space!
			</a>
		</div>
		<button
			class="navbar-toggler"
			type="button"
			data-bs-toggle="collapse"
			data-bs-target="#navbarResponsive"
			aria-controls="navbarResponsive"
			aria-expanded="false"
			aria-label="Toggle navigation"
		>
			<span class="navbar-toggler-icon"></span>
		</button>
		<div class="collapse navbar-collapse mt-2 mt-lg-0" id="navbarResponsive">
			<ul class="navbar-nav ms-auto pt-2 pt-lg-0">
				<li class="nav-item">
					<a class="nav-link" href={resolve('/')} class:active={$page.url.pathname === '/'}>Home</a>
				</li>
				<li class="nav-item">
					<a
						class="nav-link"
						href={resolve('/biochemical')}
						class:active={$page.url.pathname.includes('biochemical')}>Biochemical</a
					>
				</li>
				<li class="nav-item">
					<a
						class="nav-link"
						href={resolve('/composite')}
						class:active={$page.url.pathname.includes('composite')}>Composite</a
					>
				</li>
				<li class="nav-item">
					<a
						class="nav-link"
						href={resolve('/hybrid')}
						class:active={$page.url.pathname.includes('hybrid')}>Hybrid</a
					>
				</li>
				<li class="nav-item">
					<a
						class="nav-link"
						href={resolve('/settings')}
						class:active={$page.url.pathname.includes('settings')}>Settings</a
					>
				</li>
				<li class="nav-item">
					<a
						class="nav-link"
						href={resolve('/api')}
						class:active={$page.url.pathname.includes('/api')}>API</a
					>
				</li>
				<li class="nav-item d-lg-none">
					<a class="nav-link" href="https://d-scan.space" target="_blank" rel="noopener"
						>Try D-Scan.Space!</a
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

{@render children?.()}

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
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
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

<div
	class="modal fade"
	id="partnerModal"
	tabindex="-1"
	aria-labelledby="partnerModalLabel"
	aria-hidden="true"
>
	<div class="modal-dialog modal-dialog-centered modal-lg">
		<div class="modal-content bg-dark text-white">
			<div class="modal-header">
				<h1 class="modal-title fs-5" id="partnerModalLabel">EVE Online Partner</h1>
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
			</div>
			<div class="modal-body">
				<p>
					<img src="/PartnerBadge2.png" class="partner-image" alt="EVE Partner" />
				</p>
				<p>
					Proud member of the EVE Online Partner Program.
					<br />
					Support me by using code <strong class="patreon">oxed</strong> on the
					<strong class="patreon">EVE Online Store</strong>, and I will receive a small commission
					(5%) on your purchase. No extra cost to you, this is CCP sharing their profits with me.
					<br />
					This will help keep the site running and up to date.
					<br />
					Thank you for your support!
				</p>
			</div>
		</div>
	</div>
</div>

<footer class="footer bg-dark" data-bs-theme="dark">
	<div class="container">
		<div class="row gy-2 align-items-md-center">
			<div class="col-12 col-md">
				<span class="text-body-secondary d-block"
					>Support me by using code <strong class="patreon">oxed</strong> on the
					<strong class="patreon">EVE Online Store</strong>
					- Thanks! |
					<a href="https://www.patreon.com/EVEReactionsCalculator" target="_blank">Patreon</a> |
					<a href="https://github.com/zmiguel/Eve-Reactions-Calculator" target="_blank"
						>Report Issue</a
					></span
				>
			</div>
			<div
				class="col-12 col-md-4 d-flex flex-wrap align-items-center gap-2 justify-content-start justify-content-md-end p-0"
			>
				<button
					type="button"
					class="btn btn-link text-body-secondary text-start text-md-end text-decoration-none p-0"
					data-bs-toggle="modal"
					data-bs-target="#partnerModal"
				>
					EVE Online Partner!
				</button>
				<span class="text-body-secondary d-none d-md-inline">|</span>
				<button
					type="button"
					class="btn btn-link text-body-secondary text-start text-md-end text-decoration-none p-0"
					data-bs-toggle="modal"
					data-bs-target="#copyrightModal"
				>
					CCP Copyright Notice
				</button>
			</div>
		</div>
	</div>
</footer>
