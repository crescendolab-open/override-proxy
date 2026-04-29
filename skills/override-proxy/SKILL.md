---
name: override-proxy
description: Install, build, modify, debug, and validate override-proxy local mock/proxy setups. Use when Codex needs to add override-proxy as a project-local devDependency, create or edit override-proxy config files, author HTTP rules with rule(), configure route-scoped proxy targets or rewrites, add raw WebSocket direct/bridge/mock rules, troubleshoot matching/proxy/CORS issues, or work inside the @crescendolab/override-proxy source checkout.
---

# override-proxy

Use this skill to work with `@crescendolab/override-proxy`, an override-first local development proxy: matching rules respond locally, and unmatched HTTP or WebSocket traffic proxies to upstream targets.

## Workflow

1. Identify the operating context before editing.
   - In an app consuming the package, import helpers from `@crescendolab/override-proxy`.
   - In the source checkout, read `AGENTS.md`, `README.md`, and `docs/TOOLS.md` if present, then follow local imports such as `./config.js` and `./utils.js` before build output exists.
2. Choose the project-local install or source-checkout path before assuming the CLI or package import is available.
   - Read `references/installation.md` when setup is missing, unclear, or user preference matters.
   - For consuming apps, install `@crescendolab/override-proxy` as a devDependency and run the CLI through the project's package manager, such as `pnpm exec override-proxy`.
   - Do not recommend global or ephemeral CLI runners unless the user explicitly asks for that tradeoff and accepts that config imports still need a local dependency.
3. Keep config as the source of truth.
   - Create or edit `override-proxy.config.ts` or a local ignored variant.
   - Import rule values explicitly into config; do not add runtime directory scanning, registry scripts, folder toggles, or implicit rule discovery.
4. Add the smallest rule/config change that satisfies the request.
   - Prefer one concern per rule module.
   - Use stable `name` values when startup or match logs need clarity.
   - Put secrets only in `.env.local`; keep committed rules and fixtures synthetic.
5. Validate before serving.
   - Installed package: `pnpm exec override-proxy validate`.
   - Source checkout: `pnpm exec tsx cli.ts validate`, then focused tests or `pnpm run build` when source behavior changes.
6. Test the behavior with a focused request or WebSocket client.
   - Check logs for `[id] match <ruleName>` and `via override` or `via proxy`.
   - If a rule should pass through, call `next()` intentionally and verify the fallback path.

## Load References

- Read `references/installation.md` for project-local devDependency and source-checkout setup decisions.
- Read `references/config-and-rules.md` for config shape, HTTP rule recipes, route matching, rewrites, env, validation, and troubleshooting.
- Read `references/websocket.md` when adding or debugging raw WebSocket direct, bridge, mock, message-rule, or connection-rule behavior.
- If modifying the override-proxy source repository, prefer the repo's current docs and tests over this skill when they conflict.

## Decision Guide

- Need only a local HTTP mock: add `rule()` and attach it to `route.http.rules`.
- Need partial real upstream behavior: give the route a `target`; unmatched requests proxy automatically.
- Need a mount path that should disappear upstream: set `rewrite: { stripPrefix: true }`.
- Need multiple upstream areas: add multiple routes with segment-aware prefixes, usually keeping `/` as fallback.
- Need unchanged WebSocket forwarding: use `ws: { mode: "direct", target }`.
- Need to inspect or mutate WebSocket messages: use `mode: "bridge"` with `wsRule()`.
- Need real upstream data plus injected mock events: use `mode: "bridge"` with `connectionRules` for injection and `rules` for selective interception.
- Need a local-only WebSocket: use `mode: "mock"` with `wsRule()` or `wsConnectionRule()`.

## Guardrails

- Preserve the override-first contract: first matching enabled rule short-circuits; no match proxies when a target exists.
- Keep route selection based on pathname, not query strings. Put query/header/body checks in rule `test()` functions.
- For WebSocket upstream targets, prefer the upstream origin/base path; override-proxy appends the client request path after route rewrites.
- Do not add production dependencies unless the user approves.
- Do not expose secrets through fixtures, `/__env`, control endpoints, logs, or generated responses.
- Keep examples anonymous and synthetic; do not copy customer names, internal service names, real tokens, or production payloads into committed docs or skill references.
- Remember that WebSocket support is raw WebSocket traffic, not Socket.IO protocol decoding.
