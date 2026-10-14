<script lang="ts">
	import AccountTabs from '$lib/components/account/AccountTabs.svelte';

	let { children } = $props();
</script>

<AccountTabs />
{@render children()}
