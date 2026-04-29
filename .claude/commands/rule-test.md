# Test Override Rules

Generate focused tests for rules that are imported by the active config.

## Invocation

- `/rule-test <ruleName>` - Test one imported rule.
- `/rule-test <path>` - Generate tests for the route and rules matching a path.
- `/rule-test --all --config <path>` - Generate tests for all rules attached by
  a config.

## Workflow

1. Identify the active config and validate it:
   - Source checkout: `pnpm exec tsx cli.ts validate --config <path>`.
   - Consuming app: `pnpm exec override-proxy validate --config <path>`.
2. Read the imported rule modules referenced by that config.
3. Extract test inputs:
   - HTTP method list.
   - `path`, `RegExp`, or `test()` conditions.
   - Required headers, query parameters, and body shape.
   - Expected status and response shape from the handler.
4. Generate focused commands:
   - Success case.
   - Non-matching method/path case.
   - Required-header or required-body error case when visible.
   - Proxy fallback case for conditional rules.
5. Run tests only when a matching server is already running or the user asks to
   start one.
6. Report status, response body summary, and the expected log source:
   `via override` for matched rules or `via proxy` for fallback.

## HTTP Curl Template

```bash
curl -i -X GET "http://localhost:4000/api/users" \
  -H "x-mock-mode: 1"
```

## WebSocket Template

Use a small WebSocket client script for bridge, direct, or mock routes. Confirm
whether the upstream target is expected to receive the original request path and
query string.

## Guardrails

- Do not discover active rules by scanning directories.
- Do not create a new test harness unless the user asks for one.
- Keep generated sample data anonymous and synthetic.
- Prefer focused test scripts under `tests/` when the behavior belongs in this
  repository.
