import type { ReadonlyURL } from '$app/state';

/** Rows per page of every profits table. */
export const PAGE_SIZE = 10;

/** One page of a table: the rows plus where it is (1-based `page`, at least one page). */
export interface Paged<T> {
	rows: T[];
	page: number;
	pageCount: number;
	total: number;
}

/** Page `page` of `all` (clamped to the existing pages). */
export function paginate<T>(all: readonly T[], page: number, size = PAGE_SIZE): Paged<T> {
	const pageCount = Math.max(1, Math.ceil(all.length / size));
	const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
	return {
		rows: all.slice((current - 1) * size, current * size),
		page: current,
		pageCount,
		total: all.length
	};
}

/** The page number in query parameter `name` (1 when absent or not a positive integer). */
export function pageParam(url: ReadonlyURL, name: string): number {
	const n = Number(url.searchParams.get(name));
	return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/** `url`'s path and query with `name` set to `page` (removed for page 1). */
export function withPage(url: ReadonlyURL, name: string, page: number): string {
	const next = new URL(url.href);
	if (page <= 1) next.searchParams.delete(name);
	else next.searchParams.set(name, String(page));
	return next.pathname + next.search;
}
