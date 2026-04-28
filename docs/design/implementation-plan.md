# Implementation Plan

Use this file as the handoff checklist after context compaction. When asked "what is next?", inspect this file and recommend the first unchecked task in order. Mark tasks as complete only after the code change and the listed verification pass.

## Status Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Completed
- `[!]` Blocked

## Current Position

All implementation phases are complete. Use the checklist below to audit regressions or plan follow-up hardening.

## Phase 1: Modularize Without Behavior Change

Goal: split the current single-file runtime into focused modules while preserving legacy behavior.

- [x] Extract config/env resolution from `main.ts` without changing values.
- [x] Extract rule loading and metadata registration.
- [x] Extract logging helpers.
- [x] Extract Express app creation and HTTP override dispatch.
- [x] Extract proxy fallback creation.
- [x] Keep public exports compatible: `app`, `overrides`, `TARGET`.
- [x] Keep `pnpm dev`, `/__env`, demo rule, and proxy fallback behavior unchanged.
- [x] Verify with `npx tsc --noEmit`.
- [x] Verify legacy smoke test against `/__env` and `/__demo/hello`.

## Phase 2: Config Loading And Normalization

Goal: introduce config files and normalized config while still supporting legacy mode.

- [x] Add `defineConfig()`.
- [x] Add config discovery for `override-proxy.config.ts|mts|js|mjs`.
- [x] Add `--config <path>` parsing.
- [x] Add normalized config types.
- [x] Map legacy env into normalized config when no config exists.
- [x] Validate server names, route names, route paths, control prefix, and duplicate topology.
- [x] Add focused tests for discovery, legacy mapping, normalization, and validation.
- [x] Verify with `npx tsc --noEmit`.

## Phase 3: Multi-Server And Multi-Route HTTP

Goal: support multiple local servers and deterministic route-scoped HTTP behavior.

- [x] Start multiple configured servers in one process.
- [x] Implement route sorting by priority, longest prefix, declaration order, and root fallback.
- [x] Implement segment-aware route matching.
- [x] Make HTTP rules route-scoped.
- [x] Support route-specific targets.
- [x] Support route rewrite options.
- [x] Update startup logs to show servers, route order, targets, and rule counts.
- [x] Add integration tests for route precedence, root fallback, route-specific rules, and route-specific proxy targets.
- [x] Verify with `npx tsc --noEmit`.

## Phase 4: CLI Serve And Validation

Goal: make the project usable as a standalone CLI while preserving the current workflow.

- [x] Add a CLI entry source.
- [x] Add `override-proxy` as an alias for `override-proxy serve`.
- [x] Add `serve` with config discovery and legacy fallback.
- [x] Add `validate` to load and validate config without listening.
- [x] Add stable exit codes for usage, validation, loader, runtime, and port failures.
- [x] Update `pnpm dev` to run the CLI path in watch mode.
- [x] Add CLI tests for default config, explicit config, config factories, legacy env fallback, and validation errors.
- [x] Verify with `npx tsc --noEmit`.

## Phase 5: WebSocket Direct Proxy

Goal: support transparent WebSocket forwarding before adding message mutation.

- [x] Add WebSocket config shape under routes.
- [x] Handle HTTP server `upgrade` events.
- [x] Route upgrades using the same normalized route matching.
- [x] Reject upgrades for routes without WebSocket support.
- [x] Forward direct WebSocket traffic to upstream.
- [x] Add connection IDs and WebSocket logs.
- [x] Add integration tests for direct bidirectional forwarding and rejected upgrades.
- [x] Verify with `npx tsc --noEmit`.

## Phase 6: WebSocket Bridge And Rules

Goal: support bidirectional message-level mutation, skip, emit, and mock-only sockets.

- [x] Add `wsRule()`.
- [x] Add WebSocket rule loading and metadata.
- [x] Add bridge mode for client and upstream sockets.
- [x] Add message context with `raw`, `text`, `json`, and `jsonObject`.
- [x] Add actions: `forward`, `skip`, `emitToClient`, `emitToUpstream`, `close`, and `fail`.
- [x] Support mock-only WebSocket routes without upstream targets.
- [x] Define and implement rule error behavior.
- [x] Add integration tests for client mutation, upstream mutation, skip, emit, mock-only, invalid JSON, binary messages, and upstream failures.
- [x] Verify with `npx tsc --noEmit`.

## Phase 7: Documentation And Examples

Goal: update user-facing docs after behavior is implemented and verified.

- [x] Update `README.md` with CLI, config, multi-route, and WebSocket usage.
- [x] Update `AGENTS.md` with new architecture and commands.
- [x] Update `docs/ARCHITECTURE.md` diagrams and code location index.
- [x] Update `docs/EXAMPLES.md` with multi-route config and WebSocket examples.
- [x] Update `docs/PATTERNS.md` with route-scoped rule and WebSocket guidance.
- [x] Ensure docs distinguish raw WebSocket from Socket.IO.
- [x] Run final `git diff --check`.

## Phase 8: Package CLI Entry

Goal: make the CLI package metadata match the implemented runtime behavior.

- [x] Add side-effect-free package API entry `index.ts`.
- [x] Export `defineConfig`, `rule`, `wsRule`, config types, and rule types from the package API.
- [x] Add `bin.override-proxy` pointing at the built CLI output.
- [x] Add build config that emits `dist/` package files and declarations.
- [x] Keep legacy runtime exports available from `main.ts` and package subpath `./main`.
- [x] Add tests for package CLI metadata.
- [x] Verify built CLI with `node dist/cli.js validate`.
- [x] Verify package contents with `npm pack --dry-run`.

## Phase 9: Local Config Discovery

Goal: support local config files without making discovery broad or surprising.

- [x] Discover `override-proxy.local.config.ts|mts|js|mjs` before shared config.
- [x] Discover `override-proxy.config.local.ts|mts|js|mjs` before shared config.
- [x] Keep shared `override-proxy.config.ts|mts|js|mjs` as fallback before legacy mode.
- [x] Add tests for local-priority and shared fallback discovery.

## Phase 10: ESM Rule File Discovery

Goal: align rule file discovery with config file ESM extensions.

- [x] Load HTTP rule files from `.ts`, `.mts`, `.js`, and `.mjs`.
- [x] Load WebSocket rule files from `.ts`, `.mts`, `.js`, and `.mjs`.
- [x] Continue excluding declaration files and dotfiles.
- [x] Add `.mjs` coverage for HTTP and WebSocket rule loading.

## Phase 11: WebSocket Connection Rules

Goal: let WebSocket rules send messages and manage timers without waiting for inbound traffic.

- [x] Add `wsConnectionRule()` and connection context types.
- [x] Expose typed `client` and optional `upstream` peers with `send`, `close`, and `readyState`.
- [x] Expose `ctx.raw` for advanced access to the underlying `ws` sockets.
- [x] Add `ctx.every()` and disposer cleanup on socket close.
- [x] Queue connection-rule upstream sends while upstream is still connecting.
- [x] Add integration tests for welcome messages, heartbeat intervals, disposer cleanup, and upstream sends.

## Phase 12: Inline Config Rules

Goal: remove runtime file-based rule discovery and make config composition explicit.

- [x] Replace `rulesDir` / `rulesDirs` with inline `http.rules`, `ws.rules`, and `ws.connectionRules`.
- [x] Support config object exports, config factory exports, and async config factory exports.
- [x] Remove `--rules-dir` and legacy file rule loading.
- [x] Remove `rule-loader.ts` and `fast-glob`.
- [x] Remove obsolete rule directory scripts and file/export metadata plumbing.
- [x] Update tests and docs to import or define rules in config.

## Next-Step Rule

When the user asks for the next step:

1. Read this file.
2. Find the first phase with unchecked tasks.
3. Recommend the first unchecked task in that phase.
4. If the task is broad, break it into the smallest safe code change.
5. Do not skip ahead to WebSocket before Phases 1-4 are complete.
