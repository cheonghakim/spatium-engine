import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    runtime: "src/runtime.ts",
    builder: "src/builder.ts",
  },
  format: ["esm"],
  // rollup-plugin-dts treats workspace deps as external by default; without
  // `resolve` the published .d.ts files would keep `export * from "@indoor/..."`,
  // which doesn't exist for consumers off npm. The paths override (only for
  // this dts pass, not tsconfig.json) points it at the built declaration
  // files instead of each sibling's "types" field, which resolves straight
  // to source and isn't a valid input to declaration bundling.
  dts: {
    resolve: [/^@indoor\//],
    compilerOptions: {
      paths: {
        "@indoor/core": ["../core/dist/index.d.ts"],
        "@indoor/runtime": ["../runtime/dist/index.d.ts"],
        "@indoor/builder": ["../builder/dist/index.d.ts"],
      },
    },
  },
  clean: true,
  sourcemap: true,
  target: "es2022",
  // @indoor/* are internal workspace packages, not published separately —
  // this is the only package that publishes their code, so it must bundle
  // them in. Only real third-party deps stay external.
  external: ["three"],
});
