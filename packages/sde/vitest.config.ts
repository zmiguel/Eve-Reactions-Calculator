import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'sde',
		include: ['test/**/*.test.ts']
	}
});
