import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // Sibling workspace packages and heavy third-party libs are dependencies,
  // not part of this package's own bundle.
  external: ["@indoor/core", "three"],
});
