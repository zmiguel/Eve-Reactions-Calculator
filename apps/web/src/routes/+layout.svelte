<script lang="ts">
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { children, data } = $props();
</script>

<!-- Centered Tailwind `container` (1280 px ≥ xl, 1536 px ≥ 2xl) inside 8/32 px gutters, as on d-scan.space. -->
<div class="flex min-h-screen flex-col px-2 sm:px-8">
	<Navbar user={data.user} />
	<!-- The navbar is fixed: 48 px (h-12) plus its 1 px border. -->
	<main class="container mx-auto flex-1 pt-15">
		{@render children()}
	</main>
	<Footer />
</div>
