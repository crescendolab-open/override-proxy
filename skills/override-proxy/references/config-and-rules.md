# Config And Rules

## Installed Package Usage

Install in the app or mock workspace:

```bash
pnpm add -D @crescendolab/override-proxy
```

Create `override-proxy.config.ts`:

```ts
import { defineConfig, rule } from "@crescendolab/override-proxy";

const Ping = rule("GET", "/__ping", (_req, res) => {
  res.json({ ok: true, source: "override-proxy" });
});

export default defineConfig({
  servers: [
    {
      port: 4000,
      routes: [
        {
          path: "/",
          target: "https://pokeapi.co/api/v2/",
          http: { rules: [Ping] },
        },
      ],
    },
  ],
});
```

Validate and serve:

```bash
pnpm exec override-proxy validate
pnpm exec override-proxy serve
curl http://localhost:4000/__ping
```

Use `npx @crescendolab/override-proxy validate` and `npx @crescendolab/override-proxy serve` when there is no local package manager setup.

## Source Checkout Usage

In the source repository before build output exists, import from local source files:

```ts
import { defineConfig } from "./config.js";
import { rule } from "./utils.js";
```

Common source commands:

```bash
pnpm install
pnpm exec tsx cli.ts validate
pnpm exec tsx cli.ts serve --config ./override-proxy.config.ts
pnpm dev
pnpm run build
pnpm run typecheck
pnpm test
```

Prefer focused test scripts when a change has a narrow surface:

```bash
pnpm exec tsx tests/config.test.ts
pnpm exec tsx tests/http-routing.test.ts
pnpm exec tsx tests/cli.test.ts
```

## Config Discovery

Default discovery checks the current working directory in this order:

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

Use `--config <path>` to override discovery. If no config exists, legacy mode uses `PROXY_TARGET`, `PORT`, and `CORS_ORIGINS` with proxy-only behavior.

## Public Config Shape

```ts
import { defineConfig } from "@crescendolab/override-proxy";
import { GetUser } from "./rules/get-user.js";
import { RootHtml } from "./rules/root-html.js";

export default defineConfig({
  servers: [
    {
      name: "main",
      host: "127.0.0.1",
      port: 4000,
      cors: { origins: ["http://localhost:3000"] },
      routes: [
        {
          name: "api",
          path: "/api",
          target: "https://api.example.com",
          rewrite: { stripPrefix: true },
          http: { rules: [GetUser] },
        },
        {
          name: "root",
          path: "/",
          target: "https://www.example.com",
          http: { rules: [RootHtml] },
        },
      ],
    },
  ],
});
```

Config exports can be objects, factories, or async factories. Put filesystem reads, fixture loading, and conditional packs in the config factory:

```ts
import { readFile } from "node:fs/promises";
import { defineConfig } from "@crescendolab/override-proxy";
import { UserRule } from "./rules/user.js";

export default defineConfig(async () => {
  const user = JSON.parse(await readFile("./fixtures/user.json", "utf8"));
  return {
    servers: [
      {
        routes: [
          {
            path: "/api",
            target: "https://api.example.com",
            http: { rules: [UserRule(user)] },
          },
        ],
      },
    ],
  };
});
```

## HTTP Rules

Use the overload form for simple path matches:

```ts
import { rule } from "@crescendolab/override-proxy";

export const Ping = rule("GET", "/__ping", (_req, res) => {
  res.json({ ok: true, at: Date.now() });
});
```

Use the object form for names, multiple methods, disabled rules, custom tests, or path regular expressions:

```ts
import { rule } from "@crescendolab/override-proxy";

export const UserDetail = rule({
  name: "user-detail",
  methods: ["GET"],
  path: /^\/api\/users\/(\d+)$/,
  handler: (req, res) => {
    const match = /^\/api\/users\/(\d+)$/.exec(req.path);
    if (!match) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ id: match[1], name: `User ${match[1]}` });
  },
});
```

Object-form constraints:

- Provide `path` or `test`.
- Omit `methods` only when `GET` is intended.
- Set `enabled: false` to keep a rule imported but inactive.
- First matching enabled rule handles the request.
- If a handler calls `next()`, processing continues to later middleware or proxy fallback.

Custom test example:

```ts
export const HeaderTriggered = rule({
  name: "header-triggered",
  methods: ["GET"],
  test: (req) =>
    req.path === "/api/features" && req.headers["x-mock-mode"] === "1",
  handler: (_req, res) => {
    res.json({ features: ["core-a", "core-b"] });
  },
});
```

## Route Matching And Rewrites

Routes match the URL pathname only. Query strings do not affect route selection.

Route priority order:

1. Higher `priority`.
2. Longer path prefix.
3. Declaration order.
4. `/` as the root fallback.

Prefix matching is segment-aware:

| Route path | Matches              | Does not match |
| ---------- | -------------------- | -------------- |
| `/api`     | `/api`, `/api/users` | `/apix`        |
| `/api/`    | `/api/users`         | `/api`         |
| `/`        | all paths            | none           |

Use rewrites explicitly:

```ts
{
  path: "/api",
  target: "https://api.example.com",
  rewrite: { stripPrefix: true },
}
```

Without `stripPrefix`, `/api/users` proxies upstream as `/api/users`. With it, `/api/users` proxies as `/users`.

## Environment, Control, And Logs

Environment load order is `.env.local` then `.env.default`; first value wins and secrets belong only in `.env.local`.

Legacy variables:

- `PROXY_TARGET`: upstream fallback.
- `PORT`: preferred port; if busy, override-proxy tries the next nine ports.
- `CORS_ORIGINS`: comma-separated exact origins; empty means allow all.

Built-in endpoints:

- Legacy mode: `GET /__env` returns non-sensitive environment information.
- Config mode: `GET /__override` returns server and route snapshots unless disabled with `control: false`.

Request logs use this pattern:

```text
[id] -> METHOD /path
[id] match ruleName
[id] <- 200 12ms override ruleName
```

Use log source `override` versus `proxy` to confirm whether a rule matched.

## Troubleshooting

| Symptom                                    | Check                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Config is ignored                          | Confirm current working directory and `--config` path.                                |
| Rule does not run                          | Confirm the rule is imported and attached to the matched route's `http.rules`.        |
| Rule path misses                           | Remember `req.path` excludes query strings; put query checks in `test()`.             |
| `/api` route catches too much              | Segment-aware matching excludes `/apix`; use `priority` only for intentional overlap. |
| Upstream receives wrong path               | Check `rewrite.stripPrefix` and route `path`.                                         |
| CORS blocked                               | Match origin exactly, without trailing slash, or allow all by omitting origins.       |
| Port differs from config                   | Preferred port was busy; check startup log for selected port.                         |
| Proxy fallback fails                       | Confirm `target` is reachable and route-specific target is set.                       |
| TypeScript import fails in source checkout | Use local source imports before build; use package imports in consuming apps.         |
