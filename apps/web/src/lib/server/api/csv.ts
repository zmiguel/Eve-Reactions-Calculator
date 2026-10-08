import { CORS_HEADERS } from './http.ts';

/** RFC 4180 CSV: header row first, CRLF line breaks, numbers unformatted, `null`/`undefined` empty. */

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

type Cell = string | number | boolean | null | undefined;

function field(value: Cell): string {
	if (value === null || value === undefined) return '';
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Serialises `rows` with exactly `columns` (in that order) as the header and cell order. */
export function toCsv<C extends string>(
	columns: readonly C[],
	rows: readonly Partial<Record<C, Cell>>[]
): string {
	const lines = [columns.map(field).join(',')];
	for (const row of rows) lines.push(columns.map((c) => field(row[c])).join(','));
	return lines.join('\r\n') + '\r\n';
}

export function apiCsv<C extends string>(
	columns: readonly C[],
	rows: readonly Partial<Record<C, Cell>>[],
	cacheControl: string
): Response {
	return new Response(toCsv(columns, rows), {
		headers: { ...CORS_HEADERS, 'Content-Type': CSV_CONTENT_TYPE, 'Cache-Control': cacheControl }
	});
}
