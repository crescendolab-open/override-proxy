# Development Tools

Current tools for working on override-proxy. The runtime is config-driven:
rules are ordinary values attached to `override-proxy.config.*`; no command
scans a `rules/` directory or toggles folders.

## Core Commands

| Task                     | Command                                                          | Notes                                     |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------- |
| Install dependencies     | `pnpm install`                                                   | Run after lockfile changes                |
| Start development server | `pnpm dev`                                                       | Runs `tsx cli.ts serve` through `nodemon` |
| Validate config          | `pnpm exec tsx cli.ts validate`                                  | Loads config without listening            |
| Serve explicit config    | `pnpm exec tsx cli.ts serve --config ./override-proxy.config.ts` | Uses one config file                      |
| Build package            | `pnpm run build`                                                 | Emits `dist/` for package exports and bin |
| Validate built CLI       | `node dist/cli.js validate`                                      | Smoke test for standalone CLI             |
| Type check               | `npx tsc --noEmit`                                               | Keep strict TypeScript clean              |

## Focused Tests

Tests are no-dependency TypeScript scripts:

```bash
pnpm exec tsx tests/config.test.ts
pnpm exec tsx tests/http-routing.test.ts
pnpm exec tsx tests/cli.test.ts
pnpm exec tsx tests/ws-direct.test.ts
pnpm exec tsx tests/ws-rules.test.ts
pnpm exec tsx tests/ws-bridge.test.ts
```

Run the full local suite:

```bash
for test_file in tests/*.test.ts; do
  pnpm exec tsx "$test_file" || exit 1
done
```

## Config-Driven Rule Workflow

1. Create or update a rule module.
2. Import the rule value in `override-proxy.config.ts`.
3. Attach it to `route.rules`, `route.http.rules`, `route.ws.rules`, or `route.ws.connectionRules`.
4. Run `pnpm exec tsx cli.ts validate`.
5. Start `pnpm dev` and test the endpoint or WebSocket path.

Disable a single rule with `enabled: false`. Disable a pack by removing it from
the config array or branching inside an object, function, or async function
config export.

## Troubleshooting

| Symptom                      | Check                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Rule does not run            | Is it imported by the active config and attached to the matched route?                              |
| Config is ignored            | Confirm current working directory and `--config` path                                               |
| Built CLI fails              | Run `pnpm run build` before `node dist/cli.js ...`                                                  |
| WebSocket rule does not fire | Confirm route `ws.mode` is `bridge` or `mock`; `direct` is transparent                              |
| Dev server does not restart  | Restart `pnpm dev`; `nodemon` watches root source, config files, and local `rules/` scratch modules |

## Further Reading

- [docs/EXAMPLES.md](EXAMPLES.md) - Copy-paste examples
- [docs/PATTERNS.md](PATTERNS.md) - Best practices and pitfalls
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) - Code locations and flow diagrams
- [AGENTS.md](../AGENTS.md) - AI agent guidelines
