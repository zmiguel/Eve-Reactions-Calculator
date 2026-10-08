import { expect, test } from './fixtures';

/** Same table as the unit test in `src/routes/routes.test.ts`, against the running site. */
const CASES: [string, string][] = [
	['/composite/simple/16663', '/composite/caesarium-cadmide'],
	['/composite/complex/16671', '/composite/titanium-carbide'],
	['/composite/chain/16671', '/composite/titanium-carbide?view=chain'],
	['/composite/unrefined/32825', '/composite/unrefined-hexite'],
	['/composite/refined/32825', '/composite/unrefined-hexite?output=reprocessed'],
	['/composite/eratic/90283', '/composite/unrefined-tritanium'],
	['/composite/eratic-repro/90283', '/composite/unrefined-tritanium?output=reprocessed'],
	['/biochemical/synth/28686', '/biochemical/pure-synth-blue-pill-booster'],
	['/biochemical/standard/25237', '/biochemical/pure-standard-blue-pill-booster'],
	['/biochemical/improved/25241', '/biochemical/pure-improved-blue-pill-booster'],
	['/biochemical/improved_chain/25241', '/biochemical/pure-improved-blue-pill-booster?view=chain'],
	['/biochemical/strong/25283', '/biochemical/pure-strong-blue-pill-booster'],
	['/biochemical/strong_chain/25283', '/biochemical/pure-strong-blue-pill-booster?view=chain'],
	// The v2 biochemical pages themselves.
	['/biochemical/simple/28686', '/biochemical/pure-synth-blue-pill-booster'],
	['/biochemical/chain/25241', '/biochemical/pure-improved-blue-pill-booster?view=chain'],
	// Molecular-Forged products live on the biochemical page (product type 57465).
	['/biochemical/molecular/57465', '/biochemical/isotropic-neofullerene-gamma-9'],
	// Unknown ids, types or reactor/type combinations fall back to the reactor listing.
	['/composite/simple/99999999', '/composite'],
	['/composite/nonsense/16663', '/composite'],
	['/hybrid/simple/30306', '/hybrid']
];

for (const [from, to] of CASES) {
	test(`legacy ${from} → 301 ${to} @smoke`, async ({ request }) => {
		const response = await request.get(from, { maxRedirects: 0 });
		expect(response.status()).toBe(301);
		expect(response.headers()['location']).toBe(to);
	});
}
