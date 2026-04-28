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

| Command                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `override-proxy`            | Alias for `override-proxy serve`                  |
| `override-proxy serve`      | Start configured servers                          |
| `override-proxy validate`   | Load and validate config without listening        |
| `override-proxy inspect`    | Reserved: print normalized config and route order |
| `override-proxy list-rules` | Reserved: print loaded HTTP and WebSocket rules   |
| `override-proxy doctor`     | Reserved: check common setup problems             |
| `override-proxy init`       | Reserved: create a starter config                 |

`serve` and `validate` are implemented. The other commands are reserved in the public design so the CLI can grow predictably.

## Serve Flags

| Flag                  | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `--config <path>`     | Implemented: load explicit config file                                     |
| `--rules-dir <path>`  | Implemented: legacy single-route rules directory                           |
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

1. `override-proxy.config.ts`
2. `override-proxy.config.mts`
3. `override-proxy.config.js`
4. `override-proxy.config.mjs`

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
- HTTP rule directories.
- WebSocket rule directories.
- Local helper files imported by rule modules when the watcher can detect them.

On change, restart the process in development mode. In-process hot reload can be added later, but process restart is easier to reason about and matches current nodemon behavior.

## Legacy Compatibility

The existing workflow should still work:

```bash
pnpm dev
pnpm dev -- --rules-dir=/tmp/rules
```

Equivalent future CLI usage:

```bash
override-proxy serve
override-proxy serve --rules-dir /tmp/rules
override-proxy serve --target https://pokeapi.co/api/v2/ --port 4000
```

Legacy flags create a single server with one root route unless a config file exists. In config mode, legacy flags should either be rejected or require explicit semantics. Silent merging creates hard-to-debug behavior.

## Validate Command

`override-proxy validate` should:

- Load config.
- Normalize config.
- Validate server names, route names, ports, control prefix, route conflicts, targets, and rule directories.
- Import rules enough to verify shape.
- Exit without listening.

It should not call user handlers.

## Inspect Command

`override-proxy inspect` should print:

- Config file path.
- Normalized servers.
- Route match order.
- Targets after defaults.
- Rule counts and source files.
- Control endpoint prefix.

JSON output can be added later with `--json`.

## List-Rules Command

`override-proxy list-rules` should print loaded rules without starting servers:

```text
main api HTTP
  - GetUser rules/api/users.ts:GetUser

main chat-ws WS
  - PatchChatMessage rules/ws/chat.ts:PatchChatMessage
```

Disabled rules should appear with `(off)`.

## Use Cases

| Case                  | Description                                                          |
| --------------------- | -------------------------------------------------------------------- |
| Default serve         | `override-proxy serve` reads cwd config or enters legacy mode        |
| Explicit config       | `--config` runs a config outside cwd                                 |
| Legacy flags          | `--target`, `--port`, and `--rules-dir` preserve old workflows       |
| Multi-server override | `--server <name> --port <port>` changes one configured server        |
| Config validation     | `validate` catches topology and rule shape problems before listening |
| Runtime inspection    | `inspect` shows normalized route order and targets                   |
| Rule inventory        | `list-rules` prints rule names, sources, and disabled state          |
| Development watch     | `--watch` restarts when config or rule files change                  |

## Validation Cases

| Case                                                | Expected result                           |
| --------------------------------------------------- | ----------------------------------------- |
| `override-proxy serve` with config                  | Starts configured servers                 |
| `override-proxy serve` without config               | Starts legacy single server               |
| `override-proxy serve --config missing.ts`          | Exits with code `3` or `4`                |
| `override-proxy validate` with valid config         | Exits `0` without listening               |
| `override-proxy validate` with duplicate routes     | Exits `3`                                 |
| `override-proxy inspect`                            | Prints route order and targets            |
| `override-proxy list-rules`                         | Prints HTTP and WebSocket rules           |
| `--port` with multi-server config and no `--server` | Exits `2`                                 |
| `--rules-dir` in legacy mode                        | External rules load before built-in rules |
| `--watch`                                           | Restarts when config or rule file changes |
