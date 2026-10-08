import { readFileSync } from 'node:fs';

export const FIXTURE_URL = new URL('./fixtures/sde-mini.zip', import.meta.url);

export function fixtureBytes(): Uint8Array {
	return new Uint8Array(readFileSync(FIXTURE_URL));
}

/** A byte stream delivering `bytes` in chunks of `chunkSize` (exercises chunk boundaries). */
export function streamOf(bytes: Uint8Array, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.slice(offset, offset + chunkSize));
			offset += chunkSize;
		}
	});
}
