import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema/history.ts',
	out: './migrations/history'
});
