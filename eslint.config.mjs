import path from "node:path";
import url from "node:url";

import eslint from "@eslint/js";
import pluginVitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "coverage/**"]),
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: path.dirname(url.fileURLToPath(import.meta.url)),
      },
    },
  },
  {
    rules: {
      "no-console": "error",
      // `??` would keep an empty env var that must fall through (src/context.ts).
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/__tests__/**/*.ts"],
    plugins: { vitest: pluginVitest },
    rules: {
      ...pluginVitest.configs.recommended.rules,
      // Mock factories hand back `vi.fn()`s, which are `any` by construction.
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
]);
