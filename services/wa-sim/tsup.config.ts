import { defineConfig } from "tsup";

// One self-contained file (no runtime dependencies at all: Node built-ins and the bundled domain package).
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
