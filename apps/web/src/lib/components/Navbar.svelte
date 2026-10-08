<script lang="ts">
	import { Navbar, NavBrand, NavHamburger, NavLi, NavUl } from 'flowbite-svelte';
	import { page } from '$app/state';
	import AccountMenu, { type NavUser } from './AccountMenu.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	let { user = null }: { user?: NavUser | null } = $props();

	const links = [
		{ href: '/', label: 'Home' },
		{ href: '/composite', label: 'Composite' },
		{ href: '/biochemical', label: 'Biochemical' },
		{ href: '/hybrid', label: 'Hybrid' },
		{ href: '/planner', label: 'Planner' },
		{ href: '/settings', label: 'Settings' },
		{ href: '/api', label: 'API' }
	];

	/** The link for the current path: Home only on `/`, sections also on their detail pages (`/composite/…`). */
	const activeHref = $derived(
		links.find(({ href }) => {
			const path = page.url.pathname;
			return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
		})?.href
	);
</script>

<!-- Full-bleed bar; flowbite's non-fluid inner `container mx-auto` lines up with the page container. -->
<Navbar
	class="fixed start-0 top-0 z-30 border-b border-gray-200 bg-gray-100 px-2 py-0 sm:px-8 dark:border-gray-700 dark:bg-gray-900"
	navContainerClass="h-12 flex-nowrap"
>
	<NavBrand href="/" class="gap-2">
		<svg
			viewBox="0 0 32 32"
			class="h-7 w-7 shrink-0 text-gray-900 dark:text-white"
			fill="none"
			stroke="currentColor"
			aria-hidden="true"
		>
			<path
				d="M16 4.5 25.96 10.25v11.5L16 27.5 6.04 21.75v-11.5Z"
				stroke-width="2.5"
				stroke-linejoin="round"
			/>
			<circle cx="16" cy="16" r="4.75" stroke-width="2" />
			<circle cx="16" cy="4.5" r="2.75" fill="currentColor" stroke="none" />
			<circle cx="25.96" cy="21.75" r="2.75" fill="currentColor" stroke="none" />
			<circle cx="6.04" cy="21.75" r="2.75" fill="currentColor" stroke="none" />
		</svg>
		<span class="text-lg font-semibold whitespace-nowrap text-gray-900 sm:text-xl dark:text-white">
			EVE Reactions
		</span>
	</NavBrand>
	<NavUl
		activeUrl={activeHref}
		class="md:ms-auto md:me-6"
		classes={{
			ul: 'gap-1 p-2 md:gap-6 md:p-0',
			active: 'dark:text-white md:text-primary-700 md:dark:text-primary-400'
		}}
	>
		{#each links as link (link.href)}
			<NavLi
				href={link.href}
				class="px-3 py-2 md:p-0"
				aria-current={link.href === activeHref ? 'page' : undefined}>{link.label}</NavLi
			>
		{/each}
	</NavUl>
	<div class="flex shrink-0 items-center gap-2">
		<AccountMenu {user} />
		<ThemeToggle />
		<NavHamburger class="ms-0 cursor-pointer p-1.5" />
	</div>
</Navbar>
