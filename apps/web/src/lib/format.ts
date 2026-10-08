const UNITS: [number, string][] = [
	[1e12, 'T'],
	[1e9, 'B'],
	[1e6, 'M'],
	[1e3, 'K']
];

/** Compact ISK: `1.23M`, `-4.56B`, `950`. `null` → `n/a`. */
export function formatIsk(n: number | null | undefined, digits = 2): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
	const abs = Math.abs(n);
	for (const [size, suffix] of UNITS) {
		if (abs >= size) return `${(n / size).toFixed(digits)}${suffix}`;
	}
	return n.toFixed(abs >= 100 || Number.isInteger(n) ? 0 : digits);
}

/** Full value for `title` attributes: `1,234,567.89 ISK`. */
export function formatIskFull(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
	return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ISK`;
}

export function formatPct(n: number | null | undefined, digits = 1): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
	return `${n.toFixed(digits)}%`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
	return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** `1d 2h 3m`, `1h 19m 29s`, `45s`. */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return 'n/a';
	const total = Math.round(seconds);
	const d = Math.floor(total / 86400);
	const h = Math.floor((total % 86400) / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const parts: string[] = [];
	if (d) parts.push(`${d}d`);
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	if (s && !d) parts.push(`${s}s`);
	return parts.length ? parts.join(' ') : '0s';
}

/** `2026-10-06 12:00 UTC`; `null` → `n/a`. */
export function formatUtc(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'n/a';
	return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Coarse relative time: `just now`, `5 min ago`, `3 h ago`, `2 d ago`, `in 4 min`. */
export function formatRelative(ms: number | null | undefined, now: number): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'n/a';
	const diff = now - ms;
	const abs = Math.abs(diff);
	if (abs < 45_000) return 'just now';
	const [value, unit] =
		abs < 3_600_000
			? [Math.round(abs / 60_000), 'min']
			: abs < 86_400_000
				? [Math.round(abs / 3_600_000), 'h']
				: [Math.round(abs / 86_400_000), 'd'];
	return diff >= 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
}
