import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'eve',
		include: ['test/**/*.test.ts']
	}
});
