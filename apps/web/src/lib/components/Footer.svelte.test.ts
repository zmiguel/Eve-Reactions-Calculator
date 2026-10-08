import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Footer from './Footer.svelte';

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Footer', () => {
	it('advertises partner code oxed with the EVE Online Store link, without the commission note', () => {
		const { container } = render(Footer);
		expect(container.querySelector('strong')?.textContent).toBe('oxed');
		const store = container.querySelector('a[href="https://store.eveonline.com/"]');
		expect(store?.textContent).toContain('EVE Online Store');
		expect(text(container)).toContain('Support the site: use code oxed on the EVE Online Store');
		expect(text(container)).not.toContain('commission');
	});

	it('shows the transparent partner badge variant matching each theme', () => {
		const { container } = render(Footer);
		const badge = container.querySelector('a[href="https://www.eveonline.com/partners"]')!;
		expect(badge.className).not.toMatch(/\bbg-/);
		const images = [...badge.querySelectorAll('img')].map((img) => [img.getAttribute('src'), img.className]);
		expect(images).toEqual([
			['/PartnerBadge-light.png', expect.stringContaining('dark:hidden')],
			['/PartnerBadge-dark.png', expect.stringContaining('dark:block')]
		]);
	});

	it('links Patreon, issue tracker, About and API', () => {
		const { container } = render(Footer);
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(
			expect.arrayContaining([
				'https://www.patreon.com/EVEReactionsCalculator',
				'https://github.com/zmiguel/Eve-Reactions-Calculator/issues',
				'/about',
				'/api'
			])
		);
	});

	it('advertises D-Scan Space and Coalition Market Data', () => {
		const { getByTestId } = render(Footer);
		const tools = getByTestId('other-tools');
		const links = [...tools.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
		expect(links).toEqual([
			['D-Scan Space', 'https://d-scan.space/'],
			['Coalition Market Data', 'https://market.coalition.space/']
		]);
	});

	it('opens every external link in a new tab without dropping the referrer', () => {
		const { container } = render(Footer);
		const external = [...container.querySelectorAll('a')].filter((a) =>
			a.getAttribute('href')?.startsWith('http')
		);
		expect(external.length).toBeGreaterThan(0);
		for (const a of external) {
			expect(a.getAttribute('target'), a.getAttribute('href')!).toBe('_blank');
			expect(a.getAttribute('rel')).toBe('noopener');
		}
		const internal = [...container.querySelectorAll('a')].filter((a) =>
			a.getAttribute('href')?.startsWith('/')
		);
		for (const a of internal) expect(a.getAttribute('target')).toBeNull();
	});

	it('renders the Fenris Creations trademark and liability notices verbatim, without CCP', () => {
		const { container } = render(Footer);
		const all = text(container);
		expect(all).toContain(
			'EVE Online® and Fenris Creations™ and all related logos and other elements are trademarks of Fenris Creations.'
		);
		expect(all).toContain(
			'© 2014 Fenris Creations. All rights reserved. "EVE", "EVE Online", "Fenris Creations", and all related logos and images are trademarks or registered trademarks of Fenris Creations.'
		);
		expect(all).toContain(
			'Fenris Creations is in no way responsible for the content on or functioning of this website, nor can it be liable for any damage arising from the use of this website.'
		);
		expect(all).not.toContain('CCP');
	});
});
