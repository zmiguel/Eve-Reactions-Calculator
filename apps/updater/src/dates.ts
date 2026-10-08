export const DAY_MS = 86_400_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar day (`YYYY-MM-DD`) of a unix ms timestamp. */
export function utcDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** `true` for a real calendar day written as `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
	if (!DATE_RE.test(value)) return false;
	const ms = Date.parse(`${value}T00:00:00Z`);
	return !Number.isNaN(ms) && utcDate(ms) === value;
}

/** Unix ms of 00:00 UTC of `date`. */
export function dayStart(date: string): number {
	return Date.parse(`${date}T00:00:00Z`);
}

/** `date` shifted by `days` calendar days. */
export function addDays(date: string, days: number): string {
	return utcDate(dayStart(date) + days * DAY_MS);
}
