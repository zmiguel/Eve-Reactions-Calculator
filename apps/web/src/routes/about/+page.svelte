<script lang="ts">
	import Seo from '$lib/seo/Seo.svelte';

	const faq = [
		{
			q: 'Where do the prices come from?',
			a: 'Market orders are read from the EVE Swagger Interface (ESI) every 30 minutes for Jita 4-4, Amarr, Perimeter, Dodixie, Rens and Hek. When ESI is unavailable the Fuzzwork market aggregates are used as a fallback. Logged-in players can add structure markets their characters can see.'
		},
		{
			q: 'How often are cost indices updated?',
			a: 'System cost indices and adjusted prices are refreshed from ESI as soon as their cache expires (about hourly).'
		},
		{
			q: 'Why is a reaction shown as "n/a"?',
			a: 'At least one input or output has no price at the selected market, so the profit cannot be computed reliably.'
		},
		{
			q: 'What does "profit per slot-day" mean?',
			a: 'Profit divided by the reaction slot-days it takes, so reactions of different length and full chains (which occupy several slots) compare fairly. With single-slot allocation that is the summed duration of every job; with optimal slots it is every allocated slot × the cycle length.'
		},
		{
			q: 'Is chain surplus counted as profit?',
			a: 'No. Leftover intermediates from building a chain are listed separately and valued at the output market, but they are not added to the profit.'
		},
		{
			q: 'Can I use the data in my spreadsheet?',
			a: 'Yes, see the API page. Profits, prices, price history and cost indices can be fetched as CSV (format=csv) for Google Sheets IMPORTDATA.'
		},
		{
			q: 'Does the site use cookies?',
			a: 'The site sets only functional cookies: your theme choice, your calculator settings once you save them on the Settings page (just the values you changed from the defaults; "Reset to defaults" removes it) and, when you log in, a session cookie plus a short-lived one during the EVE login. Settings you changed on the old version of the site are carried over once into the new settings cookie, and the old cookies are removed.'
		},
		{
			q: 'Does the site use analytics?',
			a: 'Yes: Rybbit, selfhosted, and Cloudflare Web Analytics. They record page views, errors and page speed.'
		}
	];
</script>

<Seo
	title="About"
	description="How the EVE Online Reactions Calculator computes reaction profits: material and time efficiency, job costs, market fees, shipping and data sources."
	path="/about"
/>

<article
	class="grid items-start gap-4 xl:grid-cols-2 [&_a]:text-primary-700 [&_a]:underline dark:[&_a]:text-primary-300"
>
	<h1
		class="border-b-2 border-gray-300 pb-3 text-xl font-bold text-gray-800 sm:text-2xl xl:col-span-2 dark:border-gray-600 dark:text-gray-200"
	>
		About the EVE Reactions Calculator
	</h1>

	<section class="space-y-2 rounded-lg bg-white p-4 text-sm leading-relaxed sm:text-base dark:bg-gray-700">
		<h2 class="text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200">Methodology</h2>
		<p>
			Every published reaction formula from the EVE Online static data export is evaluated with your settings
			(structure, rigs, system, skills, market methods, taxes and shipping). All formulas are listed below.
		</p>
		<ul class="list-disc space-y-1.5 pl-5 marker:text-primary-600 dark:marker:text-primary-400">
			<li>
				<strong>Material modifier</strong> = 1 − rig ME bonus × security modifier (T1 2 %, T2 2.4 %; lowsec ×1.0,
				nullsec and wormhole ×1.1).
			</li>
			<li>
				<strong>Required quantity</strong> = max(runs, ⌈round(runs × base quantity × material modifier, 2)⌉).
			</li>
			<li>
				<strong>Time modifier</strong> = (1 − 4 % × Reactions skill level) × structure multiplier (Tatara 0.75,
				Athanor 1) × (1 − rig TE bonus × security modifier) (T1 20 %, T2 24 %).
			</li>
			<li>
				<strong>Runs per cycle</strong> = ⌊cycle length ÷ run time⌋, at least 1 and at most the formula's maximum
				runs.
			</li>
			<li>
				<strong>Job cost</strong> = estimated item value × (system cost index + facility tax + SCC surcharge), where
				the estimated item value is runs × Σ material quantity × ESI adjusted price.
			</li>
			<li>
				<strong>Buying inputs</strong>: buy orders pay the broker fee; instant buys pay the sell price;
				contracts use the buy, sell or split price without fees.
			</li>
			<li>
				<strong>Market depth</strong>: with buy orders or instant buys, an input is bought at the input hub
				only up to the units its sell orders currently list (shared by every job of a chain or plan); the rest
				is bought at your "Buy missing inputs from" hub (default Jita 4-4) with the same method and fees.
				Contracts and past prices are not split.
			</li>
			<li>
				<strong>Selling outputs</strong>: sell orders pay broker fee + sales tax; instant sells pay the buy
				price and sales tax; contracts pay no fees.
			</li>
			<li>
				<strong>Home page lists</strong> only show products the market can take: one slot's daily output must be
				at most 10% of the units traded per day (30-day average) in the output hub's region. The change next to
				the volume compares the last 7 days with that average.
			</li>
			<li>
				<strong>Shipping</strong> = (quantity × volume × ISK per m³ + quantity × unit price × collateral %) × (1
				− discount %), for inputs and outputs separately; the discount covers e.g. a volume discount from your hauling
				service.
			</li>
			<li>
				<strong>Chains</strong> build every intermediate that is itself a reaction product (each with its own
				reactor settings). The chain slot allocation (Settings) decides how they occupy slots:
				<em>single slot</em>
				runs one line of the chain job after job in one slot, and profit per slot-day = profit ÷ the summed job
				time in days;
				<em>optimal slots</em> runs 1 to Max parallel lines (setting, default 4) parallel lines of the final product
				(or a line count you pick on the reaction page) and gives every reaction ⌈runs ÷ runs per cycle⌉ slots,
				picking the line count with the highest profit per slot (surplus intermediates count here, as they carry
				over; within 0.5 %, the fewest lines), and shows one steady cycle after the build-up: profit per slot-day
				= profit per cycle ÷ (slots × cycle days).
			</li>
			<li>
				<strong>Planner</strong>: the targets start together and every intermediate runs in the cycle before
				the job using it, so a chain is steady after one cycle per level. Stock you hold of an intermediate
				feeds the earliest cycles first: its reaction starts later or runs fewer runs in its first cycle (and
				so do the reactions feeding it), and the targets can start sooner. The build-up never takes longer
				than without stock. Stock of a bought material covers the earliest start-up purchases. Stock is valued
				at market price: it lowers the initial investment (start-up purchases and job costs up to the first
				steady cycle, plus formulas) but not the profit per cycle. Stock the start-up does not use is listed
				as not used.
			</li>
			<li>
				<strong>Use what I have</strong> (planner): plans 1 to 12 cycles of reactions (one cycle is one round of
				jobs of your cycle length; later cycles can use what earlier ones made) that turn the stock you hold into
				more value, buying nothing but fuel blocks (and formulas, at market price, if you allow formulas you don't
				own). Items count at their sale value after fees, taxes and output shipping; items without a price count
				0. It aims for final products: an intermediate it makes and still holds at the end counts only at what went
				into it, so intermediates are made to feed later jobs. It maximises what you hold at the end minus the ISK
				spent on fuel, job costs and formulas, then rebuilds every job with exact material quantities. Fuel blocks
				you hold are used before buying. The search runs in your browser for the search time you choose (10 to 60
				seconds) and shows the best plan found so far while it looks for a better one.
			</li>
			<li>
				<strong>Reprocessing</strong> of unrefined products uses your reprocessing yield; Prismaticite outputs use
				the configured roll between the minimum and maximum quantity.
			</li>
		</ul>
	</section>

	<section class="space-y-2 rounded-lg bg-white p-4 text-sm leading-relaxed sm:text-base dark:bg-gray-700">
		<h2 class="text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200">Profit tracking</h2>
		<p>
			When you switch on Profit tracking for a character or corporation, the site reads its industry jobs,
			wallet, market orders, contracts and blueprints from EVE and works out what your reactions really
			earned. This data is only visible in your account.
		</p>
		<ul class="list-disc space-y-1 pl-5">
			<li>
				<strong>Oldest first.</strong> Everything you buy or make becomes a batch. A job uses the oldest batches
				first, and so does a sale. What a unit cost you is the price of its batch, plus the job cost for what your
				jobs made.
			</li>
			<li>
				<strong>Sales</strong> count after sales tax and broker fees, read from your wallet journal. When the journal
				does not show them, your calculator settings are used and the sale is marked "estimated".
			</li>
			<li>
				<strong>Contracts</strong> with one kind of item give it the contract price. A contract with several kinds
				of items is split by the Janice appraisal linked in its title, or else by the contract price rule of your
				profit tracking settings, and is flagged for a check when its total looks off.
			</li>
			<li>
				<strong>Inputs without a purchase</strong> (for example bought before tracking started) count at their buy
				value when the job started, marked as an estimate, until you add the purchase or correct the price.
			</li>
			<li>
				<strong>Manufacturing:</strong> reaction products used by your manufacturing jobs count either at their
				buy value on the day the job started or at what they cost you (no profit, no loss), as you choose.
			</li>
			<li>
				<strong>Fuel blocks you build:</strong> a fuel block job uses its ingredients like a reaction uses its inputs,
				oldest first, and its fuel blocks cost what went into them plus the job cost. Your reactions then use those
				fuel blocks at that cost. Fuel block jobs make no profit of their own and are not counted as reaction jobs.
			</li>
			<li>
				<strong>Material use</strong> follows the structure each job ran in, its rigs (a structure fits one rig
				of each kind) and, for manufacturing, the blueprint's material efficiency. EVE tells most of this; you fill
				in the rest on the profit tracking settings page. A reaction job whose structure or rigs are not known uses
				the ME rig of your reactor settings.
			</li>
			<li>
				<strong>Your changes:</strong> you can correct any price and add purchases EVE does not know about. Both
				are kept through later syncs, and the results are recalculated.
			</li>
			<li>
				<strong>Where prices come from:</strong> a buy value on a given day is the daily average of the market hub
				of your contract price rule, or else the average of its region that day, or else the hub's current price.
				Expected profit values the output you still hold at today's prices with your calculator settings. On the
				page of a running job it is an estimate: the output the job will make at today's value, less its inputs
				and job cost.
			</li>
		</ul>
	</section>

	<section class="space-y-2 rounded-lg bg-white p-4 text-sm leading-relaxed sm:text-base dark:bg-gray-700">
		<h2 class="text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200">FAQ</h2>
		<dl class="divide-y divide-gray-200 dark:divide-gray-600">
			{#each faq as item (item.q)}
				<div class="py-2.5 first:pt-0 last:pb-0">
					<dt class="font-semibold text-gray-800 dark:text-gray-100">{item.q}</dt>
					<dd class="mt-0.5 text-gray-700 dark:text-gray-300">{item.a}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="space-y-2 rounded-lg bg-white p-4 text-sm leading-relaxed sm:text-base dark:bg-gray-700">
		<h2 class="text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200">EVE Online Partner</h2>
		<span class="block">
			<img
				src="/PartnerBadge-light.png"
				alt="EVE Online Partner badge"
				width="272"
				height="48"
				loading="lazy"
				class="h-12 w-auto dark:hidden"
			/>
			<img
				src="/PartnerBadge-dark.png"
				alt="EVE Online Partner badge"
				width="272"
				height="48"
				loading="lazy"
				class="hidden h-12 w-auto dark:block"
			/>
		</span>
		<p>
			Proud member of the EVE Online Partner Program. Support me by using code
			<strong class="font-bold text-red-600 uppercase italic dark:text-red-300">oxed</strong> on the
			<a href="https://store.eveonline.com/" target="_blank" rel="noopener">EVE Online Store</a>. Fenris
			Creations shares a small commission (5%) with me at no extra cost to you. This helps keep the site
			running and up to date. Thank you!
		</p>
	</section>

	<section
		class="space-y-2 rounded-lg bg-white p-4 text-sm leading-relaxed sm:text-base dark:bg-gray-700"
		id="copyright-notice"
	>
		<h2 class="text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200">
			Fenris Creations Copyright Notice
		</h2>
		<p>
			EVE Online and the EVE logo are the registered trademarks of Fenris Creations. All rights are reserved
			worldwide.
		</p>
		<p>
			All other trademarks are the property of their respective owners. EVE Online, the EVE logo, EVE and all
			associated logos and designs are the intellectual property of Fenris Creations. All artwork,
			screenshots, characters, vehicles, storylines, world facts or other recognizable features of the
			intellectual property relating to these trademarks are likewise the intellectual property of Fenris
			Creations. Fenris Creations has granted permission to EVE Reactions Calculator to use EVE Online and all
			associated logos and designs for promotional and information purposes on its website but does not
			endorse, and is not in any way affiliated with, EVE Reactions Calculator.
		</p>
		<p>
			Fenris Creations is in no way responsible for the content on or functioning of this website, nor can it
			be liable for any damage arising from the use of this website.
		</p>
		<p>
			EVE Online® and Fenris Creations™ and all related logos and other elements are trademarks of Fenris
			Creations.
		</p>
	</section>
</article>
