import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../src/index.ts';

const key = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const otherKey = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 255 - i)));

describe('token encryption', () => {
	it('round-trips and uses a random IV', async () => {
		const a = await encryptToken('refresh-token-ä✓', key);
		const b = await encryptToken('refresh-token-ä✓', key);
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(await decryptToken(a, key)).toBe('refresh-token-ä✓');
		expect(await decryptToken(b, key)).toBe('refresh-token-ä✓');
	});

	it('rejects tampered ciphertext', async () => {
		const enc = await encryptToken('secret', key);
		const last = enc.at(-2) === 'A' ? 'B' : 'A';
		const tampered = enc.slice(0, -2) + last + enc.slice(-1);
		await expect(decryptToken(tampered, key)).rejects.toThrow();
	});

	it('rejects the wrong key', async () => {
		const enc = await encryptToken('secret', key);
		await expect(decryptToken(enc, otherKey)).rejects.toThrow();
	});

	it('rejects keys that are not 32 bytes', async () => {
		await expect(encryptToken('x', btoa('short'))).rejects.toThrow(/32 bytes/);
	});
});
