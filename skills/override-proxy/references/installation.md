# Installation And Invocation

Choose setup based on the user's preference, repository conventions, and the
task's persistence needs. Do not force one installation style when the context
points to another.

## Core Distinction

Separate CLI availability from package import availability:

- The `override-proxy` command can come from local package-manager exec, `npx`,
  global npm, mise, or this source checkout.
- Config files that import `defineConfig`, `rule`, `wsRule`, or
  `wsConnectionRule` from `@crescendolab/override-proxy` usually need the
  package installed in that project so module resolution works.

When both are needed, prefer a project-local dev dependency and the repository's
normal package-manager exec command.

## Selection Rules

- Existing repository with `package.json` and lockfile: follow the repository's
  package manager and add a local dev dependency when config imports the
  package.
- One-off experiment, inspection, or legacy env-only proxy: prefer ephemeral
  execution such as `npx` so project files stay untouched.
- User prefers global CLIs: use npm global install for the command, but still
  keep project config imports local when needed.
- User or repo uses mise: use mise for the CLI tool, choosing project, local, or
  global scope according to the user's intent.
- Working inside this override-proxy source checkout: do not install the
  published package into the repo for local development. Use source commands and
  local source imports before build output exists.

If the correct scope is ambiguous and installing would modify persistent files
or global user state, ask before making that install persistent.

## Command Shape

Use the environment's normal spelling rather than hardcoding one style:

- Local package-manager install: `pnpm add -D`, `npm install --save-dev`,
  `yarn add --dev`, or the repo's equivalent.
- Local execution: the repo's exec command, such as `pnpm exec` or `npm exec`.
- Ephemeral execution: `npx @crescendolab/override-proxy ...`.
- Global npm: install globally only when the user wants the command available
  everywhere.
- mise: use `mise use` for persistent tool config and `mise exec` for one-off
  execution.

After choosing a setup path, validate with the same path the user will use to
serve, so install and runtime assumptions match.
