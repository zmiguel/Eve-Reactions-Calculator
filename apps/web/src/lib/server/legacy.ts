import type { Dataset, Reactor } from '@reactions/engine';

type LegacyTarget = { query: '' | '?view=chain' | '?output=reprocessed' };

/**
 * v2 URL types → query of the new detail page. Biochemical pages were `simple`/`chain`; the other
 * biochemical keys are the old API v1 type enums (see old `api_helpers.js`), kept for links built from them.
 */
export const LEGACY_TYPES: Record<Reactor, Record<string, LegacyTarget>> = {
	composite: {
		simple: { query: '' },
		complex: { query: '' },
		chain: { query: '?view=chain' },
		unrefined: { query: '' },
		refined: { query: '?output=reprocessed' },
		eratic: { query: '' },
		'eratic-repro': { query: '?output=reprocessed' }
	},
	biochemical: {
		simple: { query: '' },
		chain: { query: '?view=chain' },
		synth: { query: '' },
		standard: { query: '' },
		improved: { query: '' },
		improved_chain: { query: '?view=chain' },
		strong: { query: '' },
		strong_chain: { query: '?view=chain' },
		molecular: { query: '' }
	},
	hybrid: {}
};

/**
 * Target of an old `/<reactor>/<type>/<productTypeId>` URL: the new detail page of the reaction
 * producing that type, or the reactor listing when the type or product is unknown.
 */
export function legacyRedirect(
	dataset: Dataset | null,
	reactor: Reactor,
	legacyType: string,
	productTypeId: number
): string {
	const target = LEGACY_TYPES[reactor][legacyType];
	const reaction = dataset?.reactions.find((r) => r.product.typeId === productTypeId);
	if (!target || !reaction) return `/${reactor}`;
	return `/${reaction.reactor}/${reaction.slug}${target.query}`;
}
