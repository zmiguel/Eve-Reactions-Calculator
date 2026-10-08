const IV_BYTES = 12;

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes standard base64 or base64url (padding optional). */
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
	const raw = base64ToBytes(keyB64);
	if (raw.length !== 32) throw new Error('Token encryption key must be 32 bytes (base64)');
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** AES-GCM 256: random 12-byte IV prefixed to the ciphertext, base64url encoded. */
export async function encryptToken(plain: string, keyB64: string): Promise<string> {
	const key = await importKey(keyB64);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const cipher = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
	);
	const out = new Uint8Array(IV_BYTES + cipher.length);
	out.set(iv);
	out.set(cipher, IV_BYTES);
	return bytesToBase64Url(out);
}

/** Inverse of `encryptToken`; rejects on a wrong key or tampered data. */
export async function decryptToken(encrypted: string, keyB64: string): Promise<string> {
	const key = await importKey(keyB64);
	const bytes = base64ToBytes(encrypted);
	if (bytes.length <= IV_BYTES) throw new Error('Encrypted token is too short');
	const plain = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) },
		key,
		bytes.slice(IV_BYTES)
	);
	return new TextDecoder().decode(plain);
}
