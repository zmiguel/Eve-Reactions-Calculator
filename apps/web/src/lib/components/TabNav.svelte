<script lang="ts" module>
	export interface Tab {
		href: string;
		label: string;
		/** Other sections whose pages belong to this tab (`/account/permissions` → Characters). */
		also?: readonly string[];
	}

	/**
	 * The current tab of `pathname`: the first tab (the section root) only on itself, the others also on
	 * their sub-pages (`/profits/jobs/123` → Jobs); any tab also on the pages under its `also` paths.
	 */
	export function currentTab(tabs: readonly Tab[], pathname: string): string | undefined {
		return tabs.find(
			({ href, also = [] }, i) =>
				pathname === href ||
				[...(i > 0 ? [href] : []), ...also].some((p) => pathname === p || pathname.startsWith(`${p}/`))
		)?.href;
	}
</script>

<script lang="ts">
	import { page } from '$app/state';

	let { label, tabs }: { label: string; tabs: readonly Tab[] } = $props();

	const current = $derived(currentTab(tabs, page.url.pathname));
</script>

<!-- The baseline is an inset shadow, so the active tab's border covers it without reaching outside the
     nav: a scroll container (overflow-x for narrow screens) would show a scrollbar for even 1px. -->
<nav
	aria-label={label}
	class="mb-4 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-gray-200)] dark:shadow-[inset_0_-1px_0_var(--color-gray-700)]"
>
	<ul class="flex min-w-max gap-1 text-sm font-medium">
		{#each tabs as tab (tab.href)}
			<li>
				<a
					href={tab.href}
					aria-current={tab.href === current ? 'page' : undefined}
					class="inline-block border-b-2 px-3 py-2 {tab.href === current
						? 'border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-400'
						: 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200'}"
					>{tab.label}</a
				>
			</li>
		{/each}
	</ul>
</nav>
