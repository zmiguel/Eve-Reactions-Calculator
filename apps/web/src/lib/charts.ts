import type { Attachment } from 'svelte/attachments';

/** Space kept between a chart tooltip and the edge of the screen, in px. */
const EDGE = 8;

/**
 * Keeps the ApexCharts tooltips under `node` inside the viewport. ApexCharts places a tooltip beside the
 * hovered point and only roughly within the chart, so a wide tooltip on a narrow chart (or a bar near the
 * edge) runs off the screen and scrolls the page sideways. Each time ApexCharts moves a tooltip, it is
 * shifted back with `translate`.
 */
export const containTooltips: Attachment<HTMLElement> = (node) => {
	const observer = new MutationObserver(() => {
		const width = document.documentElement.clientWidth;
		for (const tip of node.querySelectorAll<HTMLElement>('.apexcharts-tooltip')) {
			const parent = tip.offsetParent;
			if (!parent) continue;
			// Where ApexCharts put it: its box lags behind while the tooltip slides there.
			const left = parent.getBoundingClientRect().left + (parseFloat(tip.style.left) || 0);
			const right = left + tip.offsetWidth;
			// Too wide for the screen: the start stays visible.
			const shift = Math.round(
				left < EDGE ? EDGE - left : right > width - EDGE ? Math.max(width - EDGE - right, EDGE - left) : 0
			);
			const translate = shift === 0 ? '' : `${shift}px`;
			// Setting it changes `style` again; the next pass finds nothing to change.
			if (tip.style.translate !== translate) tip.style.translate = translate;
		}
	});
	observer.observe(node, { subtree: true, attributes: true, attributeFilter: ['style'] });
	return () => observer.disconnect();
};
