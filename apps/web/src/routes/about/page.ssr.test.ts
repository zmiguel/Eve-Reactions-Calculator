import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('about page (server-rendered)', () => {
	it('credits Fenris Creations in the copyright notice and partner section, never CCP', () => {
		const all = render(Page)
			.body.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		expect(all).toContain('Fenris Creations Copyright Notice');
		expect(all).toContain(
			'EVE Online and the EVE logo are the registered trademarks of Fenris Creations. All rights are reserved worldwide.'
		);
		expect(all).toContain(
			'Fenris Creations is in no way responsible for the content on or functioning of this website, nor can it be liable for any damage arising from the use of this website.'
		);
		expect(all).toContain('Fenris Creations shares a small commission (5%) with me at no extra cost to you.');
		expect(all).not.toContain('CCP');
	});

	it('shows the partner badge variant for each theme', () => {
		const { body } = render(Page);
		expect(body).toContain('src="/PartnerBadge-light.png"');
		expect(body).toContain('src="/PartnerBadge-dark.png"');
	});

	it('explains both chain slot allocations and their profit per slot-day', () => {
		const all = render(Page)
			.body.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ');
		expect(all).toContain('profit per slot-day = profit ÷ the summed job time in days');
		expect(all).toContain('profit per slot-day = profit per cycle ÷ (slots × cycle days)');
	});
});
