<script lang="ts" module>
	export interface NavUser {
		characterId: number;
		name: string;
		isAdmin: boolean;
	}

	export const SSO_BUTTON = {
		black: 'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-small.png',
		white: 'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-white-small.png'
	};

	export const portraitUrl = (characterId: number, size = 32) =>
		`https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;
</script>

<script lang="ts">
	import { page } from '$app/state';

	let { user = null }: { user?: NavUser | null } = $props();

	let menu: HTMLDetailsElement | undefined = $state();

	const here = $derived(page.url.pathname + page.url.search);
	const loginHref = $derived(`/auth/login?purpose=login&returnTo=${encodeURIComponent(here)}`);

	function close(focusTrigger: boolean) {
		if (!menu?.open) return;
		menu.open = false;
		if (focusTrigger) menu.querySelector('summary')?.focus();
	}

	const trigger =
		'flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-sm px-1 text-sm font-medium text-gray-700 select-none hover:text-gray-900 dark:text-gray-400 dark:hover:text-white [&::-webkit-details-marker]:hidden';
	const panel =
		'absolute end-0 z-40 mt-2 rounded-lg border border-gray-200 bg-white text-sm shadow-md dark:border-gray-600 dark:bg-gray-700';
	const item =
		'block w-full cursor-pointer px-4 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white';
</script>

<!-- A <details> disclosure: opens and closes without JS; with JS, Escape and outside clicks close it. -->
<svelte:window
	onclick={(e) => {
		if (menu && !menu.contains(e.target as Node)) close(false);
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') close(true);
	}}
/>

<details bind:this={menu} class="relative" data-account-menu>
	{#if user}
		<summary class={trigger} aria-label="Account menu for {user.name}">
			<img
				src={portraitUrl(user.characterId)}
				alt=""
				width="20"
				height="20"
				class="h-5 w-5 shrink-0 rounded-full"
			/>
			<span class="hidden max-w-32 truncate sm:inline">{user.name}</span>
			<svg class="h-3 w-3" viewBox="0 0 10 6" fill="none" stroke="currentColor" aria-hidden="true">
				<path d="m1 1 4 4 4-4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</summary>
		<div class="{panel} w-56 divide-y divide-gray-100 dark:divide-gray-600">
			<p class="truncate px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
				Logged in as <span class="font-semibold text-gray-800 dark:text-gray-200">{user.name}</span>
			</p>
			<ul class="py-1">
				<li><a href="/account" class={item} onclick={() => close(false)}>Account</a></li>
				<li>
					<a href="/account/structures" class={item} onclick={() => close(false)}>Structure markets</a>
				</li>
				{#if user.isAdmin}
					<li><a href="/admin" class={item} onclick={() => close(false)}>Admin</a></li>
				{/if}
				<li>
					<a href="/auth/login?purpose=add_character&returnTo=%2Faccount" data-sveltekit-reload class={item}
						>Add character</a
					>
				</li>
			</ul>
			<form method="POST" action="/auth/logout" class="py-1">
				<button
					type="submit"
					class="{item} text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
					>Log out</button
				>
			</form>
		</div>
	{:else}
		<summary class={trigger}>
			Log in
			<svg class="h-3 w-3" viewBox="0 0 10 6" fill="none" stroke="currentColor" aria-hidden="true">
				<path d="m1 1 4 4 4-4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</summary>
		<div class="{panel} w-max p-2">
			<a href={loginHref} data-sveltekit-reload class="block" title="Log in with EVE Online">
				<img
					src={SSO_BUTTON.black}
					alt="Log in with EVE Online"
					width="195"
					height="30"
					class="dark:hidden"
				/>
				<img
					src={SSO_BUTTON.white}
					alt="Log in with EVE Online"
					width="195"
					height="30"
					class="hidden dark:block"
				/>
			</a>
		</div>
	{/if}
</details>
