# Migrate from MSW

Convert Mock Service Worker (MSW) handlers to override-proxy rules and attach
the converted rules through config. Rule files are inert until imported by the
active `override-proxy.config.*`.

## Invocation

- `/migrate-from-msw` - Find likely MSW handler files and plan the migration.
- `/migrate-from-msw <filepath>` - Convert one MSW handlers file.
- `/migrate-from-msw --all` - Find and convert all visible MSW handler files in
  the project.

## Workflow

1. Confirm setup:
   - Ensure the consuming app has `@crescendolab/override-proxy` installed as a
     project-local devDependency.
   - Locate or create the target `override-proxy.config.ts` or local ignored
     config.
2. Discover MSW handlers:
   - Check `src/mocks/handlers.ts|js`, `**/mocks/handlers.*`, and files
     importing from `msw`.
   - Extract HTTP handlers, GraphQL handlers, and any unsupported protocol
     handlers.
3. Convert handlers into rule modules:
   - `rest.get()` / `http.get()` -> `rule("GET", ...)`.
   - `req.params` -> regex captures or explicit `test()` logic.
   - `ctx.status()` -> `res.status()`.
   - `ctx.json()` -> `res.json()`.
   - `ctx.delay()` -> async handler with `await new Promise(...)`.
4. Attach converted rules explicitly:
   - Import rule values from the target config.
   - Add HTTP rules to the relevant `route.http.rules` array.
   - Use config factories or scenario arrays for optional packs.
5. Validate and test:
   - Source checkout: `pnpm exec tsx cli.ts validate --config <path>`.
   - Consuming app: `pnpm exec override-proxy validate --config <path>`.
   - Generate focused curl commands and confirm `match <ruleName>` logs.
6. Report manual follow-ups for unsupported or ambiguous cases.

## Import Choice

Use package imports in consuming apps:

```ts
import { rule } from "@crescendolab/override-proxy";
```

Use local source imports only inside this source checkout before build output
exists:

```ts
import { rule } from "../utils.js";
```

## Basic Mapping

```ts
import { rest } from "msw";

export const handlers = [
  rest.get("/api/users/:id", (req, res, ctx) => {
    const { id } = req.params;
    return res(ctx.status(200), ctx.json({ id, name: `User ${id}` }));
  }),
];
```

```ts
import { rule } from "@crescendolab/override-proxy";

const UserDetailPath = /^\/api\/users\/([^/]+)$/;

export const UserDetail = rule({
  name: "user-detail",
  methods: ["GET"],
  path: UserDetailPath,
  handler: (req, res) => {
    const match = UserDetailPath.exec(req.path);
    res.status(200).json({ id: match?.[1] ?? "unknown" });
  },
});
```

Attach it:

```ts
import { defineConfig } from "@crescendolab/override-proxy";
import { UserDetail } from "./rules/user-detail.js";

export default defineConfig({
  servers: [
    {
      routes: [
        {
          path: "/api",
          target: "https://api.example.com",
          http: { rules: [UserDetail] },
        },
      ],
    },
  ],
});
```

## Manual Review Cases

- GraphQL handlers: convert to `POST /graphql` rules only when operation
  matching is clear; otherwise leave a manual note.
- Conditional MSW handlers: put the condition in `test()` so non-matching
  requests proxy automatically.
- WebSocket handlers: map manually to raw WebSocket `direct`, `bridge`, or
  `mock` mode. See `skills/override-proxy/references/websocket.md`.
- Stateful handlers: keep state local to the rule module or config factory, and
  make reset behavior explicit.

## Migration Report

Include:

- Source MSW files inspected.
- Converted rule modules.
- Config file and route where each rule was attached.
- Manual review items with file and line references.
- Validation and focused test commands.

## Guardrails

- Do not add runtime rule directory scanning or registry scripts.
- Do not activate converted rules by renaming folders.
- Do not commit real user data, tokens, service names, or production payloads.
- Keep generated examples synthetic and project paths relative.
