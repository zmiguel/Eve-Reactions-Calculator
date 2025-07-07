<script>
	/**
	 * @typedef {Object} Props
	 * @property {Array} items - Array of items to search through
	 * @property {string} [id] - HTML id attribute
	 * @property {string} [name] - HTML name attribute
	 * @property {string} [placeholder] - Placeholder text
	 * @property {string} [class] - CSS class
	 * @property {boolean} [required] - Whether field is required
	 * @property {boolean} [hideArrow] - Whether to hide dropdown arrow
	 * @property {string|boolean} [showClear] - Whether to show clear button
	 * @property {any} selectedItem - Currently selected item
	 * @property {Function} [onChange] - Callback when selection changes
	 */

	/** @type {Props} */
	let {
		items = [],
		id = '',
		name = '',
		placeholder = '',
		class: className = '',
		required = false,
		hideArrow = false,
		showClear = false,
		selectedItem = $bindable(),
		onChange = () => {}
	} = $props();

	let inputValue = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(-1);
	let inputElement = $state();

	// Filter items based on input value
	let filteredItems = $derived(
		items.filter((item) => item.toString().toLowerCase().includes(inputValue.toLowerCase()))
	);

	// Update input value when selectedItem changes
	$effect(() => {
		if (selectedItem) {
			inputValue = selectedItem.toString();
		}
	});

	function selectItem(item) {
		selectedItem = item;
		inputValue = item.toString();
		isOpen = false;
		highlightedIndex = -1;
		onChange();
	}

	function clearSelection() {
		selectedItem = null;
		inputValue = '';
		isOpen = false;
		highlightedIndex = -1;
		onChange();
	}

	function handleInput(event) {
		inputValue = event.target.value;
		isOpen = true;
		highlightedIndex = -1;

		// Clear selectedItem if input doesn't match
		if (selectedItem && selectedItem.toString() !== inputValue) {
			selectedItem = null;
		}
	}

	function handleKeydown(event) {
		if (!isOpen) {
			if (event.key === 'ArrowDown') {
				isOpen = true;
				highlightedIndex = 0;
				event.preventDefault();
			}
			return;
		}

		switch (event.key) {
			case 'ArrowDown':
				highlightedIndex = Math.min(highlightedIndex + 1, filteredItems.length - 1);
				event.preventDefault();
				break;
			case 'ArrowUp':
				highlightedIndex = Math.max(highlightedIndex - 1, -1);
				event.preventDefault();
				break;
			case 'Enter':
				if (highlightedIndex >= 0 && filteredItems[highlightedIndex]) {
					selectItem(filteredItems[highlightedIndex]);
				}
				event.preventDefault();
				break;
			case 'Escape':
				isOpen = false;
				highlightedIndex = -1;
				event.preventDefault();
				break;
		}
	}

	function handleFocus() {
		if (filteredItems.length > 0) {
			isOpen = true;
		}
	}

	function handleBlur() {
		// Delay closing to allow click events on items
		setTimeout(() => {
			isOpen = false;
			highlightedIndex = -1;
		}, 150);
	}
</script>

<div class="autocomplete-container">
	<div class="autocomplete-input-container">
		<input
			bind:this={inputElement}
			{id}
			{name}
			{placeholder}
			{required}
			class="autocomplete-input {className}"
			type="text"
			bind:value={inputValue}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onfocus={handleFocus}
			onblur={handleBlur}
			autocomplete="off"
		/>
		{#if showClear && selectedItem}
			<button
				type="button"
				class="autocomplete-clear"
				onclick={clearSelection}
				aria-label="Clear selection"
			>
				×
			</button>
		{/if}
		{#if !hideArrow}
			<button
				type="button"
				class="autocomplete-arrow"
				onclick={() => (isOpen = !isOpen)}
				aria-label="Toggle dropdown"
			>
				▼
			</button>
		{/if}
	</div>

	{#if isOpen && filteredItems.length > 0}
		<div class="autocomplete-dropdown">
			{#each filteredItems as item, index}
				<div
					class="autocomplete-item {index === highlightedIndex ? 'highlighted' : ''}"
					onclick={() => selectItem(item)}
					onkeydown={(e) => e.key === 'Enter' && selectItem(item)}
					role="option"
					aria-selected={index === highlightedIndex}
					tabindex="-1"
				>
					{item}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.autocomplete-container {
		position: relative;
		display: inline-block;
		width: 100%;
	}

	.autocomplete-input-container {
		position: relative;
		display: flex;
		align-items: center;
	}

	.autocomplete-input {
		width: 100%;
		padding-right: 60px; /* Space for clear and arrow buttons */
	}

	.autocomplete-clear,
	.autocomplete-arrow {
		position: absolute;
		right: 0;
		background: none;
		border: none;
		padding: 8px;
		cursor: pointer;
		color: #666;
		font-size: 14px;
		line-height: 1;
	}

	.autocomplete-clear {
		right: 30px;
		font-size: 18px;
		font-weight: bold;
	}

	.autocomplete-clear:hover,
	.autocomplete-arrow:hover {
		color: #333;
	}

	.autocomplete-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: white;
		border: 1px solid #ddd;
		border-top: none;
		max-height: 200px;
		overflow-y: auto;
		z-index: 1000;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.autocomplete-item {
		padding: 8px 12px;
		cursor: pointer;
		border-bottom: 1px solid #f0f0f0;
	}

	.autocomplete-item:last-child {
		border-bottom: none;
	}

	.autocomplete-item:hover,
	.autocomplete-item.highlighted {
		background-color: #f0f0f0;
	}

	.autocomplete-item.highlighted {
		background-color: #e3f2fd;
	}
</style>
