import { defineConfig } from "tsup";

// One self-contained file: the shared domain package and every npm dependency are bundled, so the runtime
// image needs no `npm install` (no second registry download, and exactly the versions in the lockfile).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  splitting: false,
  noExternal: [/.*/],
  // Bundled CommonJS packages call require(); give the ES module one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
});
