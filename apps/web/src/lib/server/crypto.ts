export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Random URL-safe token (default 32 bytes). */
export function randomToken(bytes = 32): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Inverse of `bytesToBase64Url`; throws on characters outside the base64url alphabet. */
export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
	const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** HMAC-SHA256 key from a base64 secret of at least 32 bytes (`SESSION_SECRET`). */
export async function hmacKey(secretB64: string): Promise<CryptoKey> {
	const raw = Uint8Array.from(atob(secretB64.trim()), (c) => c.charCodeAt(0));
	if (raw.length < 32) throw new Error('SESSION_SECRET must be at least 32 bytes (base64)');
	return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
