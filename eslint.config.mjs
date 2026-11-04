import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["node_modules/**", ".cache/**", ".impeccable/**", "build/**", "main.js", "scripts/**", "tests/**", "esbuild.config.mjs", "eslint.config.mjs"]),
  ...obsidianmd.configs.recommended,
  // Apply the same official TypeScript rules inside Svelte scripts and templates.
  ...obsidianmd.configs.recommended
    .filter(config => JSON.stringify(config.files ?? []).includes("{ts,cts,mts,tsx}"))
    .map(config => ({ ...config, files: ["src/**/*.svelte"] })),
  ...svelte.configs["flat/base"],
  {
    files: ["src/**/*.ts", "src/**/*.svelte"],
    languageOptions: { globals: { DEV: "readonly" }, parserOptions: { projectService: true, extraFileExtensions: [".svelte"] } },
  },
  {
    files: ["src/**/*.ts", "src/**/*.svelte"],
    rules: { "obsidianmd/ui/sentence-case": ["warn", { brands: ["Dowse", "WebGPU"], acronyms: [ "GPU", "PDF", "PDFs", "API"] }] },
  },
  {
    files: ["src/**/*.svelte"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
]);
