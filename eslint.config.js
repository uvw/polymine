import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  {
    ignores: [
      "dist/",
      "target/",
      "coverage/",
      "src-tauri/",
      "ui/src/lib/bindings/",
      ".playwright-mcp/",
      // Git ignores these local folders, but flat-config ESLint doesn't read .gitignore.
      "docs/local/",
      ".claude/",
    ],
  },
  js.configs.recommended,
  ...ts.configs.strict,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
);
