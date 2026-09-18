# Contributing

This is a pnpm workspace (Node 20, TypeScript 5.6, Vite 5, Vue 3) licensed
under the [MIT License](LICENSE).

## Setup

```sh
pnpm install
```

`pnpm install` also installs the git hooks (via the root `prepare` script /
husky) — see [Pre-commit hook](#pre-commit-hook) below.

## Everyday commands

Run these from the repo root; pnpm fans them out across the workspace.

| Command               | What it does                                                            |
| ---------------------- | ------------------------------------------------------------------------ |
| `pnpm dev:studio`      | Starts the `@app/studio` Vite dev server (http://localhost:5173).       |
| `pnpm typecheck`       | Runs `tsc`/`vue-tsc --noEmit` in every package/app.                     |
| `pnpm test`            | Runs the Vitest suite for every package.                                |
| `pnpm lint`            | Runs ESLint across the repo.                                            |
| `pnpm format`          | Formats the whole repo in place with Prettier.                         |
| `pnpm format:check`    | Checks formatting without writing (used in CI-style checks).           |
| `pnpm build`           | Builds `packages/*` (core, editor, runtime, builder, exporter,          |
|                        | vectorize, spatium-engine) with `tsup`, emitting `dist/` (ESM + `.d.ts`) |
|                        | for each.                                                                |

During development, `@indoor/*` packages are resolved straight from their
`src/index.ts` (via each package's `exports` map and pnpm's workspace
symlinks) — this is what keeps `pnpm dev:studio` and `pnpm test` fast and
in sync with source changes without requiring a build step first. `pnpm
build` produces the compiled `dist/` output that a real published/consumed
package would ship.

**Exception:** `@indoor/exporter`'s tests deliberately break this rule. To
prove exported apps are genuinely standalone (no `workspace:*` deps that
only resolve inside this monorepo), the exporter esbuild-bundles
`@indoor/builder` into a vendored file at export time, and that bundling
resolves through each package's `exports` map the same way a real consumer
would — i.e. to `dist/index.js`, not `src/index.ts`. That means
`packages/core`, `packages/runtime`, and `packages/builder` must already be
built before `pnpm --filter @indoor/exporter test` (or `pnpm test` at the
root) can pass. Run `pnpm build` first if you hit a
"cannot bundle the vendor file" error.

`packages/spatium-engine` — the single package published to npm, bundling
`@indoor/core`, `@indoor/runtime`, and `@indoor/builder` — has the same
requirement for `pnpm build`: it inlines those three packages' `dist/`
output (JS and `.d.ts`) into its own `dist/`, so they must be built first.
Its own `typecheck` script is unaffected and still resolves `@indoor/*`
straight from source, matching every other package.

## Pre-commit hook

A husky pre-commit hook runs `lint-staged`, which runs `eslint --fix` and
`prettier --write` on staged `*.{ts,vue,js}` files only. This keeps commits
clean without reformatting the whole repo on every commit.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:
`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm build` →
`pnpm test` → `pnpm lint`. Build runs before test (see the `@indoor/exporter`
exception above) — `pnpm build`'s own recursive step already builds
`packages/*` in dependency order, so this is the only cross-script ordering
that matters. Please make sure all of these pass locally before opening a PR.

`.github/workflows/deploy-pages.yml` runs on every push to `main`: it builds
`@app/studio` (Vite's `base` is set to `/spatium-engine/` for that build only —
see `apps/studio/vite.config.ts`) and deploys it to GitHub Pages as the
project's live demo. Requires the repo's Settings → Pages → Build and
deployment → Source to be set to "GitHub Actions" (one-time, done in the
GitHub UI, not from this workflow).
