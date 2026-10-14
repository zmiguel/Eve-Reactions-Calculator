import { createSubscriber } from 'svelte/reactivity';

/**
 * Re-runs readers of {@link isDark} when the `dark` class of `<html>` changes (the theme toggle flips it
 * in place, without a reload). One observer for the whole page while anything reads it.
 */
const subscribe = createSubscriber((update) => {
	const observer = new MutationObserver(update);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	return () => observer.disconnect();
});

/**
 * Whether the page is in dark mode, reactively (charts recolour on a theme toggle). On the server there
 * is no document: dark, the default theme.
 */
export function isDark(): boolean {
	if (typeof document === 'undefined') return true;
	subscribe();
	return document.documentElement.classList.contains('dark');
}
