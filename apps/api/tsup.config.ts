import { defineConfig } from "tsup";

// Bundle the shared domain package into the service; keep npm dependencies external.
export default defineConfig({ entry: ["src/index.ts"], format: ["esm"], target: "node20", outDir: "dist", clean: true, splitting: false, noExternal: ["@routelanka/domain"] });
