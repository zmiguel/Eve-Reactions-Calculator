import { readFileSync } from 'node:fs';
import { readIndustrySources, type IndustrySources } from '../src/index.ts';

export const FIXTURE_URL = new URL('./fixtures/sde-mini.zip', import.meta.url);

export function fixtureBytes(): Uint8Array {
	return new Uint8Array(readFileSync(FIXTURE_URL));
}

/** The Hoboleaks fixtures (manufacturing and reaction entries of the files fetched on 2026-10-14). */
export function industryFixture(): IndustrySources {
	const read = (file: string): unknown =>
		JSON.parse(readFileSync(new URL(`./fixtures/hoboleaks/${file}`, import.meta.url), 'utf8'));
	return readIndustrySources(read('industrymodifiersources.json'), read('industrytargetfilters.json'));
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
