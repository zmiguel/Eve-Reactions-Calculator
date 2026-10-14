<script lang="ts" module>
	/** The account pages, in tab order. */
	export const ACCOUNT_TABS = [
		{ href: '/account', label: 'Characters', also: ['/account/permissions'] },
		{ href: '/account/connections', label: 'Connections' },
		{ href: '/account/inventory', label: 'Inventory' },
		{ href: '/account/tracking', label: 'Profit tracking' },
		{ href: '/account/structures', label: 'Structure markets' }
	] as const;
</script>

<script lang="ts">
	import TabNav from '../TabNav.svelte';
</script>

<TabNav label="Account pages" tabs={ACCOUNT_TABS} />
