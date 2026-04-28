# CLI Design

The CLI should make override-proxy usable outside this repository while preserving the current development workflow.

## Package Entry

`package.json` exposes the CLI bin and side-effect-free package API:

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "override-proxy": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./main": {
      "types": "./dist/main.d.ts",
      "import": "./dist/main.js"
    },
    "./cli": {
      "types": "./dist/cli.d.ts",
      "import": "./dist/cli.js"
    }
  }
}
```

During TypeScript development, `pnpm dev` keeps using `tsx` and points at the CLI source. `pnpm run build` emits `dist/cli.js` for direct Node execution and package installation.

## Commands

| Command                   | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `override-proxy`          | Alias for `override-proxy serve`                  |
| `override-proxy serve`    | Start configured servers                          |
| `override-proxy validate` | Load and validate config without listening        |
| `override-proxy inspect`  | Reserved: print normalized config and route order |
| `override-proxy inspect`  | Reserved: print normalized servers and routes     |
| `override-proxy doctor`   | Reserved: check common setup problems             |
| `override-proxy init`     | Reserved: create a starter config                 |

`serve` and `validate` are implemented. The other commands are reserved in the public design so the CLI can grow predictably.

## Serve Flags

| Flag                  | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `--config <path>`     | Implemented: load explicit config file                                     |
| `--cwd <path>`        | Reserved: resolve default config and relative paths from another directory |
| `--host <host>`       | Reserved: override host for single-server config                           |
| `--port <port>`       | Reserved: override port for single-server config                           |
| `--server <name>`     | Reserved: select server for server-specific overrides                      |
| `--target <url>`      | Reserved: legacy single-route target override                              |
| `--watch`             | Reserved: restart on config and rules changes                              |
| `--no-control`        | Reserved: disable control endpoints                                        |
| `--log-level <level>` | Reserved: set log verbosity                                                |

If config defines multiple servers, flags that target one server must require `--server <name>`.

## Config Discovery

Default lookup uses the effective cwd:

1. `override-proxy.local.config.ts`
2. `override-proxy.local.config.mts`
3. `override-proxy.local.config.js`
4. `override-proxy.local.config.mjs`
5. `override-proxy.config.local.ts`
6. `override-proxy.config.local.mts`
7. `override-proxy.config.local.js`
8. `override-proxy.config.local.mjs`
9. `override-proxy.config.ts`
10. `override-proxy.config.mts`
11. `override-proxy.config.js`
12. `override-proxy.config.mjs`

`--config` bypasses lookup. Missing explicit config is a hard error. Missing default config enters legacy mode.

## Exit Codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | Success or graceful shutdown                            |
| `2`  | Invalid CLI usage                                       |
| `3`  | Config validation error                                 |
| `4`  | Required dependency or loader failure                   |
| `5`  | Runtime error                                           |
| `6`  | Port binding failure after configured fallback attempts |

Exit codes should be stable because `validate` and `doctor` are useful in automation.

## Startup Output

Startup output should show normalized runtime state:

```text
override-proxy 0.0.0
Config: /repo/example/override-proxy.config.ts

Server main listening http://127.0.0.1:4000
Routes:
  - api /api -> https://api.example.com
    HTTP rules: 4
    WS rules: 1
  - root / -> https://www.example.com
    HTTP rules: 2
```

Secrets, tokens, full env dumps, and full WebSocket payloads should not be printed.

## Watch Mode

`--watch` should monitor:

- Config file.
- Local helper files imported by the config or rule modules when the watcher can detect them.

On change, restart the process in development mode. In-process hot reload can be added later, but process restart is easier to reason about and matches current nodemon behavior.

## Legacy Compatibility

The existing workflow should still work:

```bash
pnpm dev
pnpm dev -- --config ./override-proxy.local.config.ts
```

Equivalent future CLI usage:

```bash
override-proxy serve
override-proxy serve --target https://pokeapi.co/api/v2/ --port 4000
```

Legacy env creates a single proxy-only server with one root route unless a config file exists. Override rules are provided through config imports, not CLI rule directories. In config mode, legacy flags should either be rejected or require explicit semantics. Silent merging creates hard-to-debug behavior.

## Validate Command

`override-proxy validate` should:

- Load config.
- Normalize config.
- Validate server names, route names, ports, control prefix, route conflicts, targets, and inline rule shapes.
- Exit without listening.

It should not call user handlers.

## Inspect Command

`override-proxy inspect` should print:

- Config file path.
- Normalized servers.
- Route match order.
- Targets after defaults.
- Rule counts and configured names.
- Control endpoint prefix.

JSON output can be added later with `--json`.

## Inspect Command

`override-proxy inspect` should print normalized routes and rule counts without starting servers:

```text
main 127.0.0.1:4000
  /api -> https://api.example.com
    HTTP rules: 2
    WS mode: bridge
    WS rules: 1
```

Detailed rule names can be added later, but the command should not depend on file paths.

## Use Cases

| Case                  | Description                                                          |
| --------------------- | -------------------------------------------------------------------- |
| Default serve         | `override-proxy serve` reads cwd config or enters legacy mode        |
| Explicit config       | `--config` runs a config outside cwd                                 |
| Legacy env            | `PROXY_TARGET`, `PORT`, and `CORS_ORIGINS` preserve proxy-only mode  |
| Multi-server override | `--server <name> --port <port>` changes one configured server        |
| Config validation     | `validate` catches topology and rule shape problems before listening |
| Runtime inspection    | `inspect` shows normalized route order, targets, and rule counts     |
| Development watch     | `--watch` restarts when config or imported files change              |

## Validation Cases

| Case                                                | Expected result                               |
| --------------------------------------------------- | --------------------------------------------- |
| `override-proxy serve` with config                  | Starts configured servers                     |
| `override-proxy serve` without config               | Starts legacy single server                   |
| `override-proxy serve --config missing.ts`          | Exits with code `3` or `4`                    |
| `override-proxy validate` with valid config         | Exits `0` without listening                   |
| `override-proxy validate` with duplicate routes     | Exits `3`                                     |
| `override-proxy inspect`                            | Prints route order and targets                |
| `--port` with multi-server config and no `--server` | Exits `2`                                     |
| `--watch`                                           | Restarts when config or imported files change |
