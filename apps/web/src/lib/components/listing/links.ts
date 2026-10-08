import type { OutputMode, Reactor, Settings, View } from '@reactions/engine';
import type { Variant } from './types.ts';

/** The visitor's tab preferences (settings), passed to every page by the root layout. */
export interface DefaultTabs {
	view: Settings['defaultView'];
	output: OutputMode;
	/** `unrefinedInChains: best`: reactions with a Using unrefined tab open on it. */
	unrefined: boolean;
}

/** The tabs one reaction page opens on without query parameters. */
export interface ReactionTabs {
	view: View;
	output: OutputMode;
}

export const DEFAULT_TABS: DefaultTabs = { view: 'single', output: 'product', unrefined: false };

/** The tab preferences of `settings`. */
export function defaultTabsOf(settings: Settings): DefaultTabs {
	return {
		view: settings.defaultView,
		output: settings.defaultOutput,
		unrefined: settings.unrefinedInChains === 'best'
	};
}

/**
 * The visitor's preferred tabs as they apply to one reaction: Using unrefined where the reaction has
 * that tab and the visitor uses unrefined routes; a reaction without a full chain always opens on buy
 * inputs and one without reprocessing on selling the product, whatever the settings say.
 */
export function tabsFor(
	prefs: DefaultTabs,
	has: { chain: boolean; unrefined: boolean; reprocessed: boolean }
): ReactionTabs {
	return {
		view: has.unrefined && prefs.unrefined ? 'unrefined' : has.chain ? prefs.view : 'single',
		output: has.reprocessed ? prefs.output : 'product'
	};
}

/**
 * Detail page URL of a reaction, opened on the given variant's tab. `defaults` are the tabs the page
 * opens on by itself (see {@link tabsFor}): those need no query, anything else is spelled out.
 */
export function reactionHref(
	reactor: Reactor,
	slug: string,
	variant: Variant = 'single',
	defaults: ReactionTabs = DEFAULT_TABS
): string {
	const view: View = variant === 'chain' || variant === 'unrefined' ? variant : 'single';
	const output: OutputMode = variant === 'reprocessed' ? 'reprocessed' : 'product';
	const q = new URLSearchParams();
	if (view !== defaults.view) q.set('view', view);
	if (output !== defaults.output) q.set('output', output);
	const query = q.toString();
	return `/${reactor}/${slug}${query ? `?${query}` : ''}`;
}
