import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Seo from './Seo.svelte';

const head = () => document.head;

afterEach(() => {
	document.head.innerHTML = '';
});

describe('Seo', () => {
	it('renders title, description, canonical without query and OG/Twitter tags', () => {
		render(Seo, { title: 'T', description: 'D', path: '/composite?date=2026-01-01#x' });
		expect(document.title).toBe('T | EVE Reactions Calculator');
		expect(head().querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
			'T | EVE Reactions Calculator'
		);
		expect(head().querySelector('meta[name="description"]')?.getAttribute('content')).toBe('D');
		expect(head().querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
			'https://reactions.coalition.space/composite'
		);
		expect(head().querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
			'https://reactions.coalition.space/composite'
		);
		expect(head().querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
			'https://reactions.coalition.space/og-default.png'
		);
		expect(head().querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe(
			'summary_large_image'
		);
		expect(head().querySelector('meta[name="robots"]')).toBeNull();
	});

	it('emits robots noindex when requested', () => {
		render(Seo, { title: 'T', description: 'D', path: '/', noindex: true });
		expect(head().querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
	});

	it('accepts a custom robots value', () => {
		render(Seo, { title: 'T', description: 'D', path: '/settings', noindex: 'noindex, follow' });
		expect(head().querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
	});

	it('serialises JSON-LD safely', () => {
		const jsonLd = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'A </script> B' };
		render(Seo, { title: 'T', description: 'D', path: '/', jsonLd });
		const script = head().querySelector('script[type="application/ld+json"]');
		expect(script?.textContent).not.toContain('</script>');
		expect(JSON.parse(script!.textContent!)).toEqual(jsonLd);
	});
});
