# Installation And Invocation

Default to a project-local devDependency. override-proxy configs usually import
helpers from `@crescendolab/override-proxy`, so the package should resolve from
the consuming project's dependency graph rather than from a global or ephemeral
CLI install.

## Primary Setup

For a pnpm project:

```bash
pnpm install -D @crescendolab/override-proxy
```

Run the CLI through that same project:

```bash
pnpm exec override-proxy validate
pnpm exec override-proxy serve
```

For repeatable team usage, prefer project scripts:

```json
{
  "scripts": {
    "proxy:validate": "override-proxy validate",
    "proxy:serve": "override-proxy serve"
  }
}
```

Then use `pnpm run proxy:validate` and `pnpm run proxy:serve`.

## Selection Rules

- Existing pnpm repository: add `@crescendolab/override-proxy` as a local
  devDependency and use `pnpm exec` or package scripts.
- Existing repository using another package manager: follow its dependency
  policy only after confirming that the user wants a non-pnpm setup.
- Source checkout of override-proxy: do not install the published package into
  this repo for local development. Use source commands and local source imports
  before build output exists.
- One-off inspection without config imports: avoid changing project files unless
  the user explicitly wants a persistent setup.

Do not recommend global installs, ephemeral CLI runners, or tool-manager shims
as the normal path. They can make the command available while leaving TypeScript
config imports unresolved or version-skewed. If a user explicitly asks for one
of those paths, explain that tradeoff first and keep committed config imports
tied to a project-local dependency.

## Source Checkout Commands

Inside this repository:

```bash
pnpm install
pnpm exec tsx cli.ts validate
pnpm exec tsx cli.ts serve --config ./override-proxy.config.ts
pnpm dev
pnpm run typecheck
pnpm test
```

After choosing a setup path, validate with the same path the user will use to
serve, so install and runtime assumptions match.
