export const MAX_SKILL_LEVEL = 5;

const level = (n: number) => Math.min(MAX_SKILL_LEVEL, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));

/**
 * Reaction job slots of `characters` characters that all train Mass Reactions and Advanced Mass Reactions
 * to the given levels: each character runs 1 job plus one per level of either skill (max 11).
 */
export function reactionSlots(
	characters: number,
	massReactions: number,
	advancedMassReactions: number
): number {
	const count = Number.isFinite(characters) ? Math.max(0, Math.floor(characters)) : 0;
	return count * (1 + level(massReactions) + level(advancedMassReactions));
}
