import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema/core.ts',
	out: './migrations/core'
});
