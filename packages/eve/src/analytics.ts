/**
 * Rybbit (analytics) traits shared by the web (browser identify on page load) and the updater
 * (server-side trait updates when affiliations change), so both send the same values.
 */

/** Rybbit instance of the site (the tracking script in `apps/web/src/app.html` loads from it). */
export const RYBBIT_ORIGIN = 'https://ry.zm.gl';

/**
 * The `corporation` and `alliance` traits of an account from its main character's names and alliance
 * id. Never `null` (a null trait removes or drops the update): a corporation not looked up yet is
 * `unknown` (alliance `unknown` too); a character without an alliance (`allianceId` null) `none`; an
 * alliance whose name is not resolved yet `unknown`.
 */
export function affiliationTraits(
	corporation: string | null,
	alliance: string | null,
	allianceId: number | null
): { corporation: string; alliance: string } {
	return {
		corporation: corporation ?? 'unknown',
		alliance: corporation === null ? 'unknown' : allianceId === null ? 'none' : (alliance ?? 'unknown')
	};
}
