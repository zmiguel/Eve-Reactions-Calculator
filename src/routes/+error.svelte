<script>
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>{page.status} - {page.error?.message}</title>
</svelte:head>
<div class="container">
	<div class="d-flex align-items-center justify-content-center">
		<div class="text-center">
			<h1 class="display-1 fw-bold">{page.status}</h1>
			<p class="lead">
				{page.error?.message}
			</p>
			<a href={resolve('/')} class="btn btn-link">Go Home</a>
		</div>
	</div>
</div>
