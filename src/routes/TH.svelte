<script>
	/**
	 * @typedef {Object} Props
	 * @property {any} handler
	 * @property {any} [orderBy]
	 * @property {string} [className]
	 * @property {import('svelte').Snippet} [children]
	 */

	/** @type {Props} */
	let { handler, orderBy = null, className = '', children } = $props();

	const sort = handler.createSort(orderBy);
</script>

<th onclick={() => sort.set()} class={className} class:active={sort.isActive}>
	<div class="flex">
		<strong>
			{@render children?.()}
		</strong>
		<span class:asc={sort.direction === 'asc'} class:desc={sort.direction === 'desc'}></span>
	</div>
</th>

<style>
	th {
		background: inherit;
		margin: 0;
		border-bottom: 1px solid #e0e0e0;
		user-select: none;
	}

	th {
		cursor: pointer;
	}

	th div.flex {
		padding: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		height: 100%;
	}

	th span {
		padding-left: 8px;
	}

	th span:before,
	th span:after {
		border: 4px solid transparent;
		content: '';
		display: block;
		height: 0;
		width: 0;
	}

	th span:before {
		border-bottom-color: #e0e0e0;
		margin-top: 2px;
	}

	th span:after {
		border-top-color: #e0e0e0;
		margin-top: 2px;
	}

	th.active span.asc:before {
		border-bottom-color: #9e9e9e;
	}

	th.active span.desc:after {
		border-top-color: #9e9e9e;
	}
</style>
