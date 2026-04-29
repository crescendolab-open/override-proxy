# Create New Override Rule

Create a focused HTTP or WebSocket override rule and attach it through config.

## Invocation

- `/rule` - Interactive mode with scenario selection.
- `/rule <scenario>` - Quick create with a scenario such as `basic`, `auth`,
  `error`, `latency`, `transform`, `conditional`, `stateful`, `websocket`, or
  `graphql`.

## Workflow

1. Identify context:
   - Consuming app: ensure `@crescendolab/override-proxy` is installed as a
     project-local devDependency.
   - Source checkout: import helpers from local source files before build output
     exists.
2. Gather rule inputs:
   - Rule name in PascalCase.
   - HTTP method or WebSocket mode.
   - Path pattern and any header/query/body conditions.
   - Target route in `override-proxy.config.ts` or a local ignored config.
3. Create the smallest rule module:
   - Consuming app import: `import { rule } from "@crescendolab/override-proxy";`
   - Source checkout import: `import { rule } from "../utils.js";` adjusted
     relative to the rule file.
   - Keep fixtures synthetic and secrets out of committed files.
4. Attach the rule explicitly in config:
   - HTTP: `route.http.rules`.
   - WebSocket messages: `route.ws.rules`.
   - WebSocket connection setup: `route.ws.connectionRules`.
5. Validate:
   - Source checkout: `pnpm exec tsx cli.ts validate --config <path>`.
   - Consuming app: `pnpm exec override-proxy validate --config <path>`.
   - Run `pnpm run typecheck` when TypeScript source changed.
6. Generate a focused curl or WebSocket test and report the expected log line.

## Patterns

- Conditional override: put the condition in `test()` so non-matching requests
  proxy automatically.
- Pass-through after a match: call `next()` only when later middleware should
  continue intentionally.
- Latency: use `async` handlers with `await new Promise(...)`.
- WebSocket direct: use a base upstream target; the request path is appended.
- WebSocket bridge injection: use `wsConnectionRule()` for local server-push
  events while upstream remains connected.

## Guardrails

- Do not add runtime rule directory scanning.
- Do not toggle rules by renaming folders.
- Do not add production dependencies without confirmation.
- Do not commit real service names, tokens, customer data, or production
  payloads in examples or fixtures.
