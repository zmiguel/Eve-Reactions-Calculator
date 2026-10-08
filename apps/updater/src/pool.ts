/** Runs `task` for every item with at most `limit` tasks in flight; items are started in order. */
export async function forEachConcurrent<T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await task(items[next++]!);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
