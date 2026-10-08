/**
 * Renders `scripts/og-default.svg` to `apps/web/static/og-default.png` (1200×630).
 * Usage: `node scripts/render-og.ts [svgFile] [pngFile]`
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SVG = fileURLToPath(new URL('./og-default.svg', import.meta.url));
export const DEFAULT_PNG = fileURLToPath(new URL('../apps/web/static/og-default.png', import.meta.url));

export function renderOg(svg: string): Uint8Array {
	const resvg = new Resvg(svg, {
		fitTo: { mode: 'width', value: 1200 },
		font: { loadSystemFonts: true, defaultFontFamily: 'Arial' }
	});
	return resvg.render().asPng();
}

if (import.meta.main) {
	const [svgPath = DEFAULT_SVG, pngPath = DEFAULT_PNG] = process.argv.slice(2);
	const png = renderOg(readFileSync(svgPath, 'utf8'));
	writeFileSync(pngPath, png);
	console.log(`Wrote ${pngPath} (${png.length} bytes)`);
}
