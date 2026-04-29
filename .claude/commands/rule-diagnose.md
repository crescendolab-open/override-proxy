# Diagnose Rule Issues

Debug rule behavior from the active config outward. Config imports are the
source of truth; rule files are inert until imported and attached to a route.

## Invocation

- `/rule-diagnose <ruleName>` - Diagnose a named rule.
- `/rule-diagnose <path>` - Diagnose the route and rule chain for a request
  path.
- `/rule-diagnose --config <path>` - Diagnose using an explicit config.

## Workflow

1. Identify the config file:
   - Use `--config` when present.
   - Otherwise follow the documented config discovery order.
2. Validate config loading:
   - Source checkout: `pnpm exec tsx cli.ts validate --config <path>`.
   - Consuming app: `pnpm exec override-proxy validate --config <path>`.
3. Trace route selection:
   - Routes match pathname only.
   - Higher priority, longer segment-aware prefix, declaration order, then `/`
     fallback decide the route.
4. Confirm rule attachment:
   - HTTP rules must be under `route.http.rules`.
   - WebSocket message rules must be under `route.ws.rules`.
   - WebSocket connection rules must be under `route.ws.connectionRules`.
5. Check rule semantics:
   - `enabled !== false`.
   - Method list includes the request method.
   - `path` or `test()` matches the request.
   - `req.path` excludes the query string.
   - Handler sends a response or intentionally calls `next()`.
6. Test with a focused request and inspect logs for `match <ruleName>` plus
   `via override` or `via proxy`.

## Common Causes

| Symptom                   | Check                                                        |
| ------------------------- | ------------------------------------------------------------ |
| Rule never runs           | Imported by config and attached to the matched route?        |
| Config ignored            | Current working directory or `--config` path wrong?          |
| Path misses               | Query checks belong in `test()`, not route paths.            |
| Unexpected proxy fallback | No enabled rule matched, or handler called `next()`.         |
| CORS error                | Origin string exact and route traffic, not control endpoint? |
| WebSocket 404 upstream    | `ws.target` should not repeat the route path.                |

## Output

Report findings with file paths, config location, route name, rule name, focused
test command, and validation result.
