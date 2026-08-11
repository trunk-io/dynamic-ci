import { writeFileSync } from "node:fs";
import { type BuildOptions, build, context } from "esbuild";

// `dist/index.js` is a committed build artifact: the runner executes it directly
// and never installs dependencies. CI fails the PR if it is stale.
const options: BuildOptions = {
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  mainFields: ["module", "main"],
  sourcemap: false,
};

// The bundle is CommonJS but this package is `type: module`, so node would read
// `dist/index.js` as ESM and die on its first `require`. This pins the directory.
const markDistCommonJs = (): void => {
  writeFileSync(
    "dist/package.json",
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
};

if (process.env["TRUNK_ESBUILD_WATCH"] === "true") {
  const ctx = await context(options);
  await ctx.watch();
  markDistCommonJs();
} else {
  await build(options);
  markDistCommonJs();
}
