# Installation And Invocation

Install override-proxy locally in the workspace that owns its config. Configs
usually import helpers from `@crescendolab/override-proxy`, so the package and
config should share a dependency graph rather than relying on a global or
ephemeral CLI install.

## Workspace Location

When the repository already maintains an override-proxy setup, follow its
instructions, package-manager policy, config layout, and rule locations.

Otherwise, keep agent-created configs, rules, fixtures, dependencies, and
generated files outside the tracked working tree. Select the location in this
order:

1. A session-scoped disposable workspace provided or designated by the active
   agent environment, following the user's established convention for that
   environment.
2. A newly created directory under the operating system's temporary directory.
3. A repository-local ignored location that follows an existing repository
   convention, such as `.local/<tool>` or `node_modules/.<tool>`.

Use capability-based discovery: the location must be writable and isolated from
tracked files, and the session-scoped option must be safe to discard with the
session. Do not assume a product-specific directory name or require a particular
agent harness. Before using the repository-local fallback, verify the exact path
is ignored; do not edit `.gitignore` merely to create scratch space.

## Setup In The Selected Workspace

For a pnpm workspace:

```bash
pnpm install -D @crescendolab/override-proxy
```

Run the CLI through that same project:

```bash
pnpm exec override-proxy validate
pnpm exec override-proxy serve
```

For a repository-maintained setup intended for repeatable team usage, prefer
project scripts:

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

- Repository with a maintained override-proxy setup: use its local dependency,
  package manager, scripts, config, and rules.
- Repository without a maintained setup: create the setup in the highest
  available disposable location from the workspace precedence above. Do not
  modify the repository solely to host agent scratch files.
- Disposable workspace: initialize only the minimal package workspace needed
  for local dependency resolution, and use its package manager consistently for
  install, validation, and serving.
- Source checkout of override-proxy: do not install the published package into
  this repo for local development. Use source commands and local source imports
  before build output exists.
- One-off inspection without config imports: avoid changing project files unless
  the user explicitly wants a persistent setup.

Do not recommend global installs, ephemeral CLI runners, or tool-manager shims
as the normal path. They can make the command available while leaving TypeScript
config imports unresolved or version-skewed. If a user explicitly asks for one
of those paths, explain that tradeoff first and keep config imports tied to a
dependency local to the workspace that owns the config.

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
