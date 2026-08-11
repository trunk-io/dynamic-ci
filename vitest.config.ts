import { defineConfig, type ViteUserConfig } from "vitest/config";

// Test files are named `*.vitest.ts` (carried over from the monorepo this action
// was extracted from, so synced test files keep matching without a rename).
const config: ViteUserConfig = defineConfig({
  test: {
    include: ["**/*.vitest.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    env: {
      NODE_ENV: "test",
    },
    // `addFileAttribute` is what lets Trunk attribute a test to its file (and so to
    // its CODEOWNERS); without it the report only carries the suite name.
    reporters: [
      "default",
      ["junit", { outputFile: "junit.xml", addFileAttribute: true }],
    ],
  },
});

export default config;
