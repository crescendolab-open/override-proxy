# Config Design

Configuration is the source of truth for future multi-server behavior. Keep the input format friendly, then normalize it into one internal shape before creating servers, routes, rules, or proxies.

## Core Model

```text
project
  servers
    routes
      transports
        rules
```

| Layer     | Responsibility                                               |
| --------- | ------------------------------------------------------------ |
| Project   | Config discovery, defaults, legacy env mapping               |
| Server    | Local host, port, CORS, control endpoints, logging scope     |
| Route     | Path prefix, target, rewrite, HTTP rules, WebSocket settings |
| Transport | HTTP or WebSocket behavior for a route                       |
| Rule      | Match request/message and return an action                   |

Rules should not need to know the full topology. They receive a stable context for the current server, route, and transport.

## Public Config Shape

```ts
import { defineConfig } from "override-proxy";

export default defineConfig({
  servers: [
    {
      name: "main",
      host: "127.0.0.1",
      port: 4000,
      cors: {
        origins: ["http://localhost:3000"],
      },
      routes: [
        {
          name: "api",
          path: "/api",
          target: "https://api.example.com",
          rulesDir: "./rules/api",
        },
        {
          name: "root",
          path: "/",
          target: "https://www.example.com",
          rulesDir: "./rules/root",
        },
      ],
    },
  ],
});
```

`defineConfig()` is a typed identity helper. It should not perform IO, import rules, or mutate config.

## Normalized Config

Implementation should convert all user input into a normalized shape before runtime:

```ts
interface NormalizedConfig {
  cwd: string;
  configFile: string | null;
  servers: NormalizedServer[];
}

interface NormalizedServer {
  name: string;
  host: string;
  preferredPort: number;
  cors: NormalizedCors;
  control: NormalizedControl | false;
  routes: NormalizedRoute[];
}

interface NormalizedRoute {
  name: string;
  path: `/${string}`;
  priority: number;
  target: string | null;
  rulesDirs: string[];
  rewrite: RouteRewrite | null;
  http: NormalizedHttpTransport;
  ws: NormalizedWsTransport | false;
}
```

Normalization should:

- Resolve relative paths from the config file directory.
- Fill defaults.
- Sort routes.
- Validate duplicate names and route conflicts.
- Convert legacy env mode into the same shape.
- Keep secrets out of logs and control endpoints.

## Config Discovery

Default discovery checks the current working directory:

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

`--config <path>` overrides discovery.

The repository `.gitignore` ignores `*.local.*`, so local config variants stay uncommitted by default.

If no config file exists, use legacy mode:

```text
server main
  port = PORT || 4000
  route /
    target = PROXY_TARGET || https://pokeapi.co/api/v2/
    rulesDirs = [--rules-dir if present, built-in rules/]
```

Legacy mode must preserve current behavior unless a future major version changes the contract.

## Precedence

For values that can come from multiple sources:

| Source            | Precedence | Notes                                   |
| ----------------- | ---------- | --------------------------------------- |
| CLI flags         | Highest    | Operational overrides only              |
| Config file       | Middle     | Topology source of truth                |
| Env files         | Low        | Legacy compatibility and local defaults |
| Built-in defaults | Lowest     | Safe fallback values                    |

CLI flags should not silently rewrite complex config topology. For example, `--port` may override one server only when there is exactly one configured server. If multiple servers exist, require `--server <name> --port <port>`.

## Route Matching

Route matching uses the URL pathname only. Query strings do not affect route selection.

Routes are sorted by:

1. Higher `priority`.
2. Longer path prefix.
3. Declaration order.
4. `/` always last when priorities are equal.

Prefix matching should be segment-aware:

| Route path | Matches              | Does not match |
| ---------- | -------------------- | -------------- |
| `/api`     | `/api`, `/api/users` | `/apix`        |
| `/api/`    | `/api/users`         | `/api`         |
| `/`        | all paths            | none           |

Duplicate route paths on the same server should be a validation error unless priorities make the intent explicit.

## Rewrite Semantics

Routes should support an explicit rewrite option:

```ts
{
  path: '/api',
  target: 'https://api.example.com',
  rewrite: {
    stripPrefix: true,
  },
}
```

Recommended first-version forms:

| Option                  | Meaning                          |
| ----------------------- | -------------------------------- |
| `stripPrefix: true`     | `/api/users` proxies as `/users` |
| `prefix: '/v2'`         | Add prefix before proxying       |
| `path: (ctx) => string` | Advanced custom rewrite          |

Default should be `stripPrefix: false` to preserve visible client paths unless users opt in.

## Control Plane

Control endpoints must be separate from user routes.

Default:

```ts
control: {
  path: '/__override',
}
```

Reserved endpoints:

| Endpoint             | Purpose                           |
| -------------------- | --------------------------------- |
| `/__override/env`    | Non-sensitive env/config snapshot |
| `/__override/routes` | Normalized route list             |
| `/__override/rules`  | Loaded HTTP and WebSocket rules   |
| `/__override/health` | Server health                     |

`control: false` disables control endpoints. If the control prefix conflicts with a user route, validation should fail unless the user explicitly disables control endpoints.

## Logging Identity

Every log line should include enough identity to debug multi-server behavior:

| Field          | Applies to                                   |
| -------------- | -------------------------------------------- |
| `serverName`   | HTTP and WebSocket                           |
| `routeName`    | HTTP and WebSocket                           |
| `requestId`    | HTTP                                         |
| `connectionId` | WebSocket                                    |
| `ruleId`       | When a rule matches                          |
| `via`          | `override`, `proxy`, `ws-forward`, `ws-mock` |

Startup logs should print normalized server and route order.

## Use Cases

| Case                           | Description                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Legacy single server           | No config file; use env and built-in `rules/` exactly like the current project |
| Single server, multiple routes | One local port serves `/api`, `/auth`, and `/` with different targets          |
| Multiple local servers         | One process starts separate local ports for independent apps or backends       |
| Route-scoped overrides         | `/api` rules do not affect `/` or `/auth` traffic                              |
| Root fallback                  | `/` catches requests that do not match more specific routes                    |
| External config project        | CLI runs from another cwd and resolves relative rule paths correctly           |
| Control endpoints              | Operators can inspect routes and rules without colliding with user traffic     |

## Validation Cases

| Case                                            | Expected result                                             |
| ----------------------------------------------- | ----------------------------------------------------------- |
| No config file                                  | Legacy config is generated                                  |
| `--config` points to missing file               | CLI exits non-zero                                          |
| Multiple routes include `/api` and `/`          | `/api/*` matches `/api` first                               |
| `/api` route receives `/apix`                   | Does not match `/api`                                       |
| Duplicate route names on one server             | Validation error                                            |
| Duplicate server names                          | Validation error                                            |
| Control prefix conflicts with a user route      | Validation error                                            |
| Multiple servers use same preferred port        | Validation warning or port fallback, based on server config |
| Config contains relative `rulesDir`             | Path resolves from config file directory                    |
| Config mode uses `--port` with multiple servers | Validation error unless server name is specified            |
