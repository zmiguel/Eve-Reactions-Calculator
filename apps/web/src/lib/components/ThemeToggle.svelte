<script lang="ts">
	function toggle() {
		const isDark = document.documentElement.classList.toggle('dark');
		document.cookie = `rc_theme=${isDark ? 'dark' : 'light'}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
	}
</script>

<button
	type="button"
	onclick={toggle}
	aria-label="Toggle dark mode"
	class="cursor-pointer rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 focus:ring-2 focus:ring-gray-300 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-gray-600"
>
	<svg class="hidden h-5 w-5 dark:block" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
		<path
			d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
			fill-rule="evenodd"
			clip-rule="evenodd"
		/>
	</svg>
	<svg class="block h-5 w-5 dark:hidden" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
		<path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
	</svg>
</button>
