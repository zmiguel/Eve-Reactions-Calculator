import globals from "globals";
import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import prettierConfig from "eslint-config-prettier";

export default [
    // Global ignores
    {
        ignores: [
            "**/.DS_Store",
            "**/node_modules",
            "build",
            ".svelte-kit",
            "package",
            "**/.env",
            "**/.env.*",
            "!**/.env.example",
            "**/pnpm-lock.yaml",
            "**/package-lock.json",
            "**/yarn.lock",
            ".wrangler"
        ],
    },
    // Base ESLint recommended config
    js.configs.recommended,
    // Svelte plugin recommended config
    ...svelte.configs.recommended,
    // Global language options
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            ecmaVersion: 2020,
            sourceType: "module",
        },
    },
    // Svelte-specific files configuration
    {
        files: ["**/*.svelte"],
        languageOptions: {
            parserOptions: {
                extraFileExtensions: [".svelte"],
            },
        },
    },
    // Prettier config to disable conflicting rules
    prettierConfig,
];