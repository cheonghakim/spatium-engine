// @ts-check
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import vuePlugin from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";

// Flatten the rule sets tsPlugin's flat/recommended preset ships as an array
// of config fragments into a single rules object we can attach to our own
// `files`-scoped block.
const tsRecommendedRules = tsPlugin.configs["flat/recommended"].reduce(
  (rules, config) => Object.assign(rules, config.rules),
  {},
);

export default [
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.vite/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsRecommendedRules,
      // The codebase's established convention for an intentionally-unused
      // binding (destructured "omit" values, interface-mandated parameters)
      // is a leading underscore; recognize it instead of flagging it.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // eslint-plugin-vue's flat/recommended preset, scoped to the one app that
  // actually has Vue SFCs (apps/studio) rather than applied repo-wide.
  ...vuePlugin.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["apps/studio/src/**/*.vue"],
  })),
  {
    files: ["apps/studio/src/**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      // All components are <script lang="ts">, type-checked separately by
      // vue-tsc (which understands the DOM lib globals); base ESLint's
      // no-undef doesn't know about ambient DOM types and only produces
      // false positives here, the same reason typescript-eslint's own
      // recommended config turns it off for .ts/.tsx files.
      "no-undef": "off",
    },
  },
];
