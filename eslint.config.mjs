import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["node_modules/**", ".cache/**", ".impeccable/**", "build/**", "main.js", "scripts/**", "tests/**", "src/dev/**", "esbuild.config.mjs", "eslint.config.mjs"]),
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
    // Shared browser/worker/Node modules have no Window; native tests exercise their timers.
    files: ["src/engine/**", "src/plugin/search.ts", "src/plugin/file-events.ts", "src/plugin/media-limits.ts"],
    rules: { "obsidianmd/prefer-window-timers": "off" },
  },
  {
    // This bootstrap executes exclusively in a Web Worker, where window does not exist.
    files: ["src/engine/web-only.ts"],
    rules: { "obsidianmd/no-global-this": "off" },
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
