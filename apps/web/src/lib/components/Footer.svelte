<script lang="ts">
	const year = new Date().getUTCFullYear();

	const links = [
		{ href: 'https://www.patreon.com/EVEReactionsCalculator', label: 'Patreon', external: true },
		{
			href: 'https://github.com/zmiguel/Eve-Reactions-Calculator/issues',
			label: 'Report issue',
			external: true
		},
		{ href: '/about', label: 'About', external: false },
		{ href: '/api', label: 'API', external: false }
	];

	/** The author's other EVE Online tools. */
	const services = [
		{ href: 'https://d-scan.space/', name: 'D-Scan Space', blurb: 'd-scan and local scan analyzer' },
		{
			href: 'https://market.coalition.space/',
			name: 'Coalition Market Data',
			blurb: 'market data and price history API'
		}
	];
</script>

<footer class="container mx-auto mt-6 border-t border-gray-200 py-3 dark:border-gray-700">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
		<div class="space-y-1">
			<ul class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
				{#each links as link (link.href)}
					<li>
						<a
							class="hover:text-gray-900 hover:underline dark:hover:text-white"
							href={link.href}
							target={link.external ? '_blank' : undefined}
							rel={link.external ? 'noopener' : undefined}>{link.label}</a
						>
					</li>
				{/each}
			</ul>
			<p class="text-xs text-gray-600 dark:text-gray-400">
				Support the site: use code
				<strong class="font-bold text-red-600 uppercase italic dark:text-red-400">oxed</strong> on the
				<a
					class="font-medium text-primary-700 hover:underline dark:text-primary-400"
					href="https://store.eveonline.com/"
					target="_blank"
					rel="noopener">EVE Online Store</a
				>
			</p>
			<p class="text-xs text-gray-600 dark:text-gray-400" data-testid="other-tools">
				More EVE tools:
				{#each services as service, i (service.href)}
					{#if i > 0}<span aria-hidden="true" class="mx-1">·</span>{/if}
					<a
						class="font-medium text-primary-700 hover:underline dark:text-primary-400"
						href={service.href}
						target="_blank"
						rel="noopener">{service.name}</a
					>
					<span>({service.blurb})</span>
				{/each}
			</p>
		</div>
		<!-- Transparent badge: dark lettering on the light theme, the original white lettering on the dark one. -->
		<a
			href="https://www.eveonline.com/partners"
			class="shrink-0 self-start md:self-auto"
			target="_blank"
			rel="noopener"
		>
			<img
				src="/PartnerBadge-light.png"
				alt="EVE Online Partner"
				width="181"
				height="32"
				loading="lazy"
				class="h-8 w-auto dark:hidden"
			/>
			<img
				src="/PartnerBadge-dark.png"
				alt="EVE Online Partner"
				width="181"
				height="32"
				loading="lazy"
				class="hidden h-8 w-auto dark:block"
			/>
		</a>
	</div>
	<p class="mt-2 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
		<span>
			EVE Online® and Fenris Creations™ and all related logos and other elements are trademarks of Fenris
			Creations.
		</span>
		<span>
			© 2014 Fenris Creations. All rights reserved. "EVE", "EVE Online", "Fenris Creations", and all related
			logos and images are trademarks or registered trademarks of Fenris Creations.
		</span>
		<span>
			Fenris Creations is in no way responsible for the content on or functioning of this website, nor can it
			be liable for any damage arising from the use of this website.
		</span>
		<span>© {year} EVE Reactions Calculator</span>
	</p>
</footer>
