// jsdom lacks matchMedia; svelte/motion (used by flowbite-svelte) queries it at import time.
if (typeof window !== 'undefined' && !window.matchMedia) {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false
		}) as MediaQueryList;
}

// jsdom lacks the <dialog> methods; flowbite-svelte's Modal opens with showModal() and closes with close().
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.show = function (this: HTMLDialogElement) {
		this.open = true;
	};
	HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.show;
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.open = false;
	};
}

// jsdom lacks the Web Animations API that Svelte transitions (the Modal's fade) run on: finish at once.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	Element.prototype.animate = function () {
		const animation = {
			onfinish: null as (() => void) | null,
			currentTime: 0,
			cancel() {},
			finish() {}
		};
		queueMicrotask(() => animation.onfinish?.());
		return animation as unknown as Animation;
	};
}
