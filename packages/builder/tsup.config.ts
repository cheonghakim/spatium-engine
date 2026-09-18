import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // Sibling workspace packages are separate published units and must not be
  // inlined into this package's bundle.
  external: ["@indoor/core", "@indoor/runtime"],
});
