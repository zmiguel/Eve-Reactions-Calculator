import type { OutputMode, SlotAllocation, View } from '@reactions/engine';

export interface DetailLinkState {
	view: View;
	outputMode: OutputMode;
	/** Explicit `?bought=` days, null for the default. */
	bought: number | null;
	range: string;
	/** Explicit `?slots=` chain slot allocation (chain views), null for the visitor's setting. */
	slots: SlotAllocation | null;
	/** Explicit `?lines=` line count of optimal slots (chain views), null for the automatic choice. */
	lines: number | null;
	/** The tab this reaction opens on without `?view=` (the visitor's setting where a chain exists). */
	defaultView?: View;
	/** The output this reaction opens on without `?output=` (the visitor's setting where reprocessing applies). */
	defaultOutput?: OutputMode;
}

/** Highest line count a visitor can pick for optimal slots on the detail page (`?lines=`). */
export const MAX_PICKED_LINES = 10;

/** Detail page URL for `state` with `overrides` applied; default values are left out of the query. */
export function detailHref(
	path: string,
	state: DetailLinkState,
	overrides: Partial<DetailLinkState> = {},
	hash = ''
): string {
	const s = { ...state, ...overrides };
	const q = new URLSearchParams();
	if (s.view !== (s.defaultView ?? 'single')) q.set('view', s.view);
	if (s.view !== 'single' && s.slots !== null) q.set('slots', s.slots);
	if (s.view !== 'single' && s.lines !== null) q.set('lines', String(s.lines));
	if (s.outputMode !== (s.defaultOutput ?? 'product')) q.set('output', s.outputMode);
	if (s.bought !== null) q.set('bought', String(s.bought));
	if (s.range !== '30d') q.set('range', s.range);
	const query = q.toString();
	return `${path}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

/** Reaction-level engine warnings; profile warnings are explained by `SettingsSummary`. */
export const WARNING_TEXT: Record<string, string> = {
	SKILL_TOO_LOW: 'Your Reactions skill is below the level this formula requires.',
	MISSING_ADJUSTED_PRICE: 'Some inputs have no adjusted price, so the job cost is underestimated.',
	CYCLE_SHORTER_THAN_RUN: 'Your cycle is shorter than one run; one run per cycle is assumed.',
	MAX_RUNS_PER_JOB:
		'This formula allows a limited number of runs per job (shown under Runs), so the job ends before your cycle does. EVE does not allow more runs in one job.',
	NO_REPROCESS_DATA: 'No reprocessing data exists for this product; the product sale is shown instead.'
};
