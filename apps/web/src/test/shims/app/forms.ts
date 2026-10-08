/**
 * Test shim for `$app/forms` (web-components project). `enhance` is a no-op action, so forms in
 * component tests behave like their no-JS version (submissions are not intercepted).
 */
export function enhance(_form: HTMLFormElement, _submit?: unknown) {
	return { destroy() {} };
}

export async function applyAction(): Promise<void> {}

export function deserialize<T>(text: string): T {
	return JSON.parse(text) as T;
}
