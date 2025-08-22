# AGENTS.md

Agent-focused instructions for working on **override-proxy**.
This file complements `README.md` (human-friendly overview) by giving
precise, low-noise guidance so coding agents can modify the project safely.

---

## 1. Project Snapshot

- Type: Node.js (TypeScript, ESM `type: module`)
- Purpose: Serve local override (mock) responses before proxying unmatched requests to an upstream API.
- Entry point: `main.ts`
- Runtime: Node `v24.5.0` (see `.nvmrc`)
- Package manager: `pnpm` (lockfile present)

Exports (treat as public API for now):

- `app` (Express instance)
- `overrides` (loaded rule list)
- `TARGET` (final upstream target URL)

---

## 2. Commands

| Action              | Command            | Notes                                      |
| ------------------- | ------------------ | ------------------------------------------ |
| Install deps        | `pnpm install`     | Run first / after lock changes             |
| Start dev server    | `pnpm dev`         | Uses `nodemon` to restart on TS/JS changes |
| Type check (ad‑hoc) | `npx tsc --noEmit` | Project is strict; keep zero errors        |

VS Code launch configs (`.vscode/launch.json`):

| Name                     | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| Dev (nodemon + tsx)      | Runs `pnpm dev` (nodemon + tsx) with auto-restart |
| Run single (tsx main.ts) | Direct one-off execution without nodemon          |

> No dedicated test suite yet. When adding features, prefer adding one (see Section 10) but do **not** block current tasks if unrequested.

---

## 3. Environment & Config

Loaded (first wins, no overwrite) via `@dotenvx/dotenvx`:

1. `.env.local` (git‑ignored; secrets & local overrides)
2. `.env.default` (committed non-secret defaults)

Variables (see `README.md` for expanded descriptions):

- `PROXY_TARGET` (default PokeAPI) – upstream fallback.
- `PORT` preferred port (auto-fallback +1 … +9 if busy).
- `CORS_ORIGINS` comma list; empty → allow all.

Never hardcode secrets. Place sensitive values only in `.env.local`. Keep `.env.default` non-sensitive.

---

## 4. Rule System Quick Reference

Rules are loaded from `rules/**/*.ts|js` (excluding `.d.ts`, dotfiles). All exports are inspected:

- Named exports whose value is an `OverrideRule` (or an array of them) are included.
- Legacy patterns: default export (single or array) and a `rules` named array are still supported.
- Export identifier overrides any internal `name` passed to `rule()` (the `name` option is deprecated—omit it).

```ts
interface OverrideRule {
  name?: string;
  enabled?: boolean; // default true
  methods: [Method, ...Method[]]; // non-empty
  test(req: Request): boolean;
  handler(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void | Promise<void>;
}
```

Helper `rule()` forms (name option removed):

```ts
// Overload form
rule(method: string | string[], path: string | RegExp, handler, options?)

// Config object form
rule({ path?: string|RegExp, test?: (req)=>boolean, methods?: string[], name?, enabled?, handler })
```

Rules:

- Provide path or test (one required)
- methods default to ["GET"] in config form; required explicitly in overload form
- First matching enabled rule short-circuits
- Export name becomes log/display name; omit `name` option

Edge cases:

- If `handler` calls `next()`, processing continues (rare—prefer return response).

### 4.1 Rule Organization & Archival Strategy

The loader (`fast-glob` with `dot: false`) ignores dot-prefixed files/folders. Use this to manage groups:

| Use case                | Action / Convention                                     |
| ----------------------- | ------------------------------------------------------- |
| Group related rules     | Place them in a subfolder (`rules/commerce/`, etc.)     |
| Temporarily disable set | Rename folder to start with `.` (`rules/.demo-pack/`)   |
| Archive old packs       | Move into `rules/.trash/<name>/` (dot keeps it ignored) |
| Restore pack            | Move back / remove leading dot                          |
| Personal scratch        | `rules/.wip/` (also add to `.gitignore` if desired)     |

No runtime registry is needed—folder naming alone controls inclusion. This keeps the import loop trivial and diff-friendly.

Guidelines:

- Keep rule code free of secrets so it can be committed & shared.
- Use stable `name` properties for log clarity.
- Prefer one concern per file; large scenario packs can have many small files rather than one mega handler.
- Prune stale archives periodically to reduce noise.
- Exceptions inside rule → 500 JSON `{ error: "override_failed" }`.

---

## 5. Logging Format

Per request numeric id (incremental):

```text
[id] -> METHOD /path
[id] match ruleName      (only if an override matched)
[id] <- <status> <ms>ms <via> <ruleName?>
```

`via` is `override` or `proxy`.

---

## 6. CORS Handling

- If `CORS_ORIGINS` is set, only listed origins allowed (exact match).
- Otherwise all origins allowed.
- Credentialed requests allowed (`credentials: true`).

When modifying CORS logic: keep error callback semantics (return standard Error object) to avoid silent rejects.

---

## 7. Port Selection

Prefers `PORT`; if occupied, iterates the next 9 ports. Log message: `Port <preferred> busy -> selected <actual>`.
Avoid changing this behavior unless you add configurability; keep deterministic attempt range (10 sequential ports) for agent predictability.

---

## 8. Safe Modification Guidelines

| Area        | Rule                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Imports     | Prefer existing deps; do **not** add new packages unless required.                               |
| Style       | Prettier handles formatting (VSCode settings). Keep single quotes consistent with existing code. |
| Type Safety | Maintain zero `tsc --noEmit` errors. Use explicit return types for exported helpers.             |
| Exports     | Preserve `app`, `overrides`, `TARGET`. Document additions here if you export more.               |
| Errors      | Use consistent JSON shape: `{ error: string, detail?: string }` for new error responses.         |
| Logging     | Reuse existing helper functions instead of ad‑hoc `console.log`.                                 |

---

## 9. Adding a New Rule (Recipe)

1. Create a file under `rules/` (e.g. `rules/user-detail.ts`).
2. Implement using `rule()` helper.
3. Use `path: '/api/foo'` or `path: /^\/api\/foo\//` or custom `test`.
4. Return response via `res.json(...)`. Avoid blocking long operations; simulate delay with `await new Promise(r=>setTimeout(r, ms))`.
5. Save: nodemon reloads automatically. Confirm presence in startup `Overrides:` list.
6. Send request; verify log shows `match <ruleName>` and `via override`.

Disable temporarily by setting `enabled: false` (it will still list with `(off)`).

---

## 10. (Optional) Introducing Tests

Currently no test harness. If asked to add tests:

- Add dev deps: `vitest` + `@types/node` (already implicitly covered by TS libs) & a script `"test": "vitest"`.
- Place tests under `tests/` or alongside source with `.test.ts` suffix.
- Test contracts: rule matching order, error handling (override error → 500), proxy fallback functionality, CORS behavior for allowed & disallowed origins.

Do **not** add unless explicitly requested.

---

## 11. Security Checklist (When Making Changes)

- Never expose full environment; `/__env` intentionally redacts secrets.
- Keep proxy errors generic (no internal stack leaks) — current handler returns `{ error: "proxy_error" }`.
- Reject disallowed CORS origins via error callback; do not silently allow.
- Avoid adding dynamic `eval` / Function constructors.

---

## 12. Future Extensions (Tracked Ideas)

| Idea                      | Notes                                             |
| ------------------------- | ------------------------------------------------- |
| `/__rules` endpoint       | JSON list (name, enabled, hits) for observability |
| Runtime toggle            | PATCH change `enabled` without restart            |
| Latency / fault injection | Configurable delay or 4xx/5xx simulation per rule |
| Hot in-process reload     | Replace rule modules without full nodemon restart |
| Metrics                   | Simple in-memory counters + timestamps            |
| Priority ordering         | Explicit numeric `priority` field                 |

If implementing, update this file & README accordingly.

---

## 13. Minimal Review Checklist (Pre-commit)

1. Types compile: `npx tsc --noEmit` → 0 errors.
2. Server boots: `pnpm dev` (no runtime exceptions) & logs override list.
3. New rules hit as expected (manual curl test).
4. No unnecessary dependencies added / removed.
5. README & AGENTS.md updated if public contracts change.

---

## 14. Troubleshooting

| Symptom           | Check                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| Rule not listed   | Filename under `rules/`? Export pattern valid? No thrown import error (check console). |
| Rule not matching | Path vs `req.path` (exclude query)? Regex escaping correct? Method allowed?            |
| CORS blocked      | Origin string exact (no trailing slash) & present in `CORS_ORIGINS`?                   |
| Port mismatch     | Preferred port busy → see log; adjust `PORT` or free the port.                         |
| Proxy errors      | Upstream reachable? `PROXY_TARGET` trailing slash ok (middleware handles)              |

---

## 15. When In Doubt

Prefer minimal, incremental changes. Keep the override-first contract intact. If a change might alter request flow order (logging, override loop, proxy config), highlight it prominently in future PR descriptions.

---

## 16. Metadata

- Maintainer / Author: Crescendo Lab (2025)
- License: Apache-2.0 (see `LICENSE`)
- Contact: (add internal channel if needed)

---

Happy automating.
