import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // Sibling workspace packages are separate published units and must not be
  // inlined into this package's bundle. esbuild is a real npm devDependency
  // this package calls at runtime (to bundle the vendor file) — it ships its
  // own native binary and relies on its own package layout, so it must stay
  // a normal `import "esbuild"` rather than get inlined too.
  external: ["@indoor/core", "@indoor/builder", "esbuild"],
});
