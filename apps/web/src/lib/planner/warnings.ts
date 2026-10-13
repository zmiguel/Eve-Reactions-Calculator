/** Text of the engine's plan warning codes shared by the planner's results ("Plan targets" and "Use what I have"). */
export const PLAN_WARNING_TEXT: Record<string, string> = {
	MAX_RUNS_PER_JOB:
		'A formula in this plan allows fewer runs per job than your cycle could fit (Molecular-Forged: 100), so its jobs end early.',
	SKILL_TOO_LOW: 'Your Reactions skill is below the level a formula in this plan requires.',
	COST_INDEX_MISSING: 'No reaction cost index is known for your system; job costs assume 0%.',
	MISSING_ADJUSTED_PRICE: 'Some inputs have no adjusted price, so job costs are underestimated.',
	HUB_UNAVAILABLE: 'A market hub in your settings is not available to you; Jita 4-4 prices are used instead.',
	CYCLE_SHORTER_THAN_RUN: 'Your cycle is shorter than one run; one run per cycle is assumed.'
};
