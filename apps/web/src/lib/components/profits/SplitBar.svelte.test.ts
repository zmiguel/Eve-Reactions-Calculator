import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SplitBar from './SplitBar.svelte';

const segments = [
	{ label: 'sold', value: 60, tone: 'green' as const },
	{ label: 'used by later jobs', value: 0, tone: 'blue' as const },
	{ label: 'unsold', value: 20, tone: 'gray' as const }
];

describe('SplitBar', () => {
	it('sizes each part by its share and leaves out empty parts', () => {
		const { container } = render(SplitBar, { segments });
		const parts = [...container.querySelectorAll<HTMLElement>('[data-segment]')];
		expect(parts.map((p) => [p.dataset.segment, p.style.width])).toEqual([
			['sold', '75%'],
			['unsold', '25%']
		]);
	});

	it('lists every part in words, as a legend when asked', () => {
		const plain = render(SplitBar, { segments }).container;
		expect(plain.querySelector('.sr-only')?.textContent).toBe('60 sold, 0 used by later jobs, 20 unsold');
		const legend = render(SplitBar, { segments, legend: true }).container;
		expect(legend.querySelector('.sr-only')).toBeNull();
		expect(legend.textContent).toContain('used by later jobs');
	});

	it('an empty whole draws no parts', () => {
		const { container } = render(SplitBar, {
			segments: segments.map((s) => ({ ...s, value: 0 }))
		});
		expect(container.querySelectorAll('[data-segment]')).toHaveLength(0);
	});
});
