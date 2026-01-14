# Patterns & Best Practices

Proven patterns, conventions, and anti-patterns for maintaining a healthy override-proxy codebase.

## Rule Organization Patterns

### Pattern 1: Single Responsibility

**Principle:** One rule file = One logical endpoint or feature.

✅ **Good:**

```
rules/
├── user-profile.ts      # GET /api/users/:id
├── user-create.ts       # POST /api/users
└── user-update.ts       # PATCH /api/users/:id
```

❌ **Avoid:**

```
rules/
└── everything.ts        # 50 different endpoints in one file
```

**Why:** Easier to locate, modify, and disable specific mocks.

---

### Pattern 2: Feature-Based Grouping

**Principle:** Group related rules by domain or feature.

✅ **Good:**

```
rules/
├── auth/
│   ├── login.ts
│   ├── logout.ts
│   └── refresh-token.ts
├── commerce/
│   ├── cart.ts
│   ├── checkout.ts
│   └── orders.ts
└── analytics/
    ├── events.ts
    └── reports.ts
```

**Benefits:**
- Easy to disable entire features (rename folder to `.auth/`)
- Clear ownership and responsibility
- Better discoverability

---

### Pattern 3: Environment-Based Organization

**Principle:** Separate rules by environment or scenario.

```
rules/
├── demo/               # Demo/presentation scenarios
│   ├── happy-path.ts
│   └── error-cases.ts
├── dev/                # Development overrides
│   └── fast-responses.ts
└── .staging/           # Disabled - staging overrides
    └── slow-network.ts
```

**Use case:** Switch between different mock scenarios by renaming folders.

---

### Pattern 4: Shared Utilities

**Principle:** Extract reusable logic to separate files.

```
rules/
├── _helpers/           # Prefix with _ to indicate non-rule files
│   ├── auth.ts         # Shared auth logic
│   ├── data.ts         # Test data generators
│   └── validators.ts   # Input validation
├── users.ts            # Uses helpers
└── orders.ts           # Uses helpers
```

**Example:**

```typescript
// rules/_helpers/auth.ts
export function requireAuth(req: Request): { valid: boolean; userId?: number } {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token === 'valid-token') {
    return { valid: true, userId: 1 };
  }
  return { valid: false };
}

// rules/users.ts
import { rule } from '../utils.js';
import { requireAuth } from './_helpers/auth.js';

export const UserProfile = rule('GET', '/api/profile', (req, res) => {
  const auth = requireAuth(req);
  if (!auth.valid) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ id: auth.userId, name: 'Test User' });
});
```

---

### Pattern 5: Layered Architecture

**Principle:** Separate data, logic, and handlers.

```
rules/
├── _data/
│   ├── users.json      # Static test data
│   └── products.json
├── _services/
│   ├── user-service.ts # Business logic
│   └── auth-service.ts
└── api/
    ├── users.ts        # HTTP handlers
    └── auth.ts
```

**Benefits:**
- Testable business logic
- Reusable across rules
- Clear separation of concerns

---

## Naming Conventions

### File Names

| Type | Convention | Examples |
|------|------------|----------|
| Single endpoint | `{resource}-{action}.ts` | `user-create.ts`, `order-cancel.ts` |
| Multiple related | `{resource}.ts` | `users.ts`, `products.ts` |
| Feature group | `{feature}/` folder | `auth/`, `commerce/` |
| Helpers/utilities | `_{name}.ts` or `_helpers/` | `_validators.ts`, `_helpers/auth.ts` |
| Test data | `_{resource}-data.ts` | `_users-data.ts` |
| Archived | `.trash/{name}/` | `.trash/old-feature/` |
| WIP/Personal | `.wip/` or `.{name}/` | `.wip/experimental.ts` |

**Case:** kebab-case for files, PascalCase for exports.

---

### Export Names

✅ **Good:**

```typescript
// Descriptive, action-oriented
export const UserDetail = rule(...);
export const CreateOrder = rule(...);
export const RefreshAuthToken = rule(...);
```

❌ **Avoid:**

```typescript
// Too generic
export const Rule1 = rule(...);
export const Handler = rule(...);
export const Temp = rule(...);
```

**Principle:** Export name becomes the rule name in logs. Make it descriptive and unique.

---

### Rule Name Guidelines

| Scenario | Naming Pattern | Example |
|----------|----------------|---------|
| Resource detail | `{Resource}Detail` | `UserDetail`, `OrderDetail` |
| Create action | `Create{Resource}` | `CreateUser`, `CreateOrder` |
| List/query | `List{Resource}s` | `ListUsers`, `ListProducts` |
| Update action | `Update{Resource}` | `UpdateUser`, `UpdateSettings` |
| Delete action | `Delete{Resource}` | `DeleteUser`, `DeleteOrder` |
| Auth-related | `{Action}Auth` | `LoginAuth`, `RefreshToken` |
| Error simulation | `Simulate{Error}` | `Simulate404`, `SimulateTimeout` |

---

### Folder Naming

| Purpose | Pattern | Example |
|---------|---------|---------|
| Feature domain | lowercase, kebab-case | `user-management/`, `order-processing/` |
| Environment | lowercase | `dev/`, `staging/`, `demo/` |
| Disabled | `.{name}/` | `.old-feature/`, `.experimental/` |
| Archive | `.trash/{name}/` | `.trash/2024-q1/` |
| Personal | `.{initials}/` or `.wip/` | `.john/`, `.wip/` |

---

### Toggle Methods

Two ways to disable rules:

| Method | Scope | File Import | Log Display | Use Case |
|--------|-------|-------------|-------------|----------|
| `enabled: false` | Single rule | ✅ Yes | Shows "(off)" | Quick toggle, debugging |
| Dot-prefix folder | Entire group | ❌ No | Not listed | Archive, experiments |

**Example:**

```typescript
// Single rule toggle
export const Debug = rule({
  enabled: false,  // Quick disable
  path: '/api/debug',
  handler: ...
});
```

```bash
# Group toggle (CLI tool)
./scripts/toggle-rules.sh disable experimental
# Renames: rules/experimental/ → rules/.experimental/
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Rule Order Matters

❌ **Problem:**

```typescript
// File: rules/users.ts

// Generic rule first (will match all /api/users/*)
export const AllUsers = rule({
  path: /^\/api\/users\/.*/,
  handler: (req, res) => res.json({ generic: true }),
});

// Specific rule never gets hit!
export const SpecialUser = rule({
  path: '/api/users/999',
  handler: (req, res) => res.json({ special: true }),
});
```

✅ **Solution:** Place specific rules before generic ones.

```typescript
// Specific first
export const SpecialUser = rule({
  path: '/api/users/999',
  handler: (req, res) => res.json({ special: true }),
});

// Generic second
export const AllUsers = rule({
  path: /^\/api\/users\/.*/,
  handler: (req, res) => res.json({ generic: true }),
});
```

**Or:** Use separate files and rely on alphabetical loading.

```
rules/
├── users-999-special.ts   # Loads first alphabetically
└── users-generic.ts       # Loads second
```

---

### Pitfall 2: Forgetting Async/Await

❌ **Problem:**

```typescript
export const Slow = rule('GET', '/api/slow', (req, res) => {
  // This doesn't work! Handler returns immediately
  setTimeout(() => res.json({ done: true }), 1000);
});
```

✅ **Solution:** Use `async` and `await` with Promise.

```typescript
export const Slow = rule('GET', '/api/slow', async (req, res) => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  res.json({ done: true });
});
```

---

### Pitfall 3: Test Function Always Returns True

❌ **Problem:**

```typescript
export const Broken = rule({
  test: (req) => {
    console.log('Checking request...');
    // Forgot to return boolean!
  },
  handler: (req, res) => res.json({ ok: true }),
});
```

**Result:** Rule never matches (implicit `undefined` is falsy).

✅ **Solution:** Always return boolean from `test()`.

```typescript
export const Fixed = rule({
  test: (req) => {
    console.log('Checking request...');
    return req.path === '/api/data'; // Explicit return
  },
  handler: (req, res) => res.json({ ok: true }),
});
```

---

### Pitfall 4: Method Mismatch

❌ **Problem:**

```typescript
export const PostOnly = rule('POST', '/api/data', ...);
```

**Test:**

```bash
curl http://localhost:4000/api/data  # GET request - won't match!
```

✅ **Solution:** Verify HTTP method in test.

```bash
curl -X POST http://localhost:4000/api/data  # Correct
```

**Or:** Support multiple methods.

```typescript
export const MultiMethod = rule(['GET', 'POST'], '/api/data', ...);
```

---

### Pitfall 5: Memory Leaks in Stateful Rules

❌ **Problem:**

```typescript
// Global state grows indefinitely
const requestLog: any[] = [];

export const LogRequests = rule('GET', '/api/data', (req, res) => {
  requestLog.push({ timestamp: Date.now(), path: req.path });
  res.json({ totalRequests: requestLog.length });
});
```

**Result:** After 100k requests, memory bloats.

✅ **Solution:** Implement size limits or TTL.

```typescript
const MAX_LOG_SIZE = 1000;
const requestLog: any[] = [];

export const LogRequests = rule('GET', '/api/data', (req, res) => {
  requestLog.push({ timestamp: Date.now(), path: req.path });

  // Keep only last N entries
  if (requestLog.length > MAX_LOG_SIZE) {
    requestLog.shift();
  }

  res.json({ totalRequests: requestLog.length });
});
```

---

### Pitfall 6: Path vs. OriginalUrl

❌ **Problem:**

```typescript
export const Query = rule({
  test: (req) => req.path === '/api/data?mock=1',  // Wrong!
  handler: ...
});
```

**Why:** `req.path` excludes query string. Use `req.originalUrl` or `req.query`.

✅ **Solution:**

```typescript
export const Query = rule({
  test: (req) => req.path === '/api/data' && req.query['mock'] === '1',
  handler: ...
});
```

---

### Pitfall 7: Not Handling Errors in Async Handlers

❌ **Problem:**

```typescript
export const Fetch = rule('GET', '/api/data', async (req, res) => {
  const data = await fetch('https://upstream.com/data'); // Might throw!
  const json = await data.json();
  res.json(json);
});
```

**Result:** Unhandled rejection crashes or hangs request.

✅ **Solution:** Wrap in try-catch.

```typescript
export const Fetch = rule('GET', '/api/data', async (req, res) => {
  try {
    const data = await fetch('https://upstream.com/data');
    const json = await data.json();
    res.json(json);
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: 'fetch_failed', detail: String(err) });
  }
});
```

---

### Pitfall 8: Confusing Disable Methods

❌ **Problem:** Mixing or misunderstanding the two ways to disable rules.

**Two disable methods:**

1. **Single rule**: `enabled: false` in rule config
   - File still imports
   - Rule shows in logs as "(off)"
   - Quick toggle without file changes

2. **Entire group**: Dot-prefix folder name
   - Files not imported at all
   - No log entries
   - Clean for archived/experimental code

```typescript
// Single rule disable - still loads
export const MyRule = rule({
  enabled: false,  // Shows as "(off)" in logs
  handler: ...
});

// Group disable - doesn't load
// File: rules/.disabled/my-rule.ts
export const MyRule = rule(...);  // File not imported!
```

✅ **Solution:**
- Use `enabled: false` for temporary single rule toggle
- Use dot-prefix folder for disabling entire feature sets
- Check server startup logs to verify rule state
- Use `scripts/toggle-rules.sh` for group management

---

## Testing Strategies

### Strategy 1: Manual Testing with curl

**Quick feedback loop:**

```bash
# Test in terminal
curl http://localhost:4000/api/data

# With headers
curl -H "Authorization: Bearer token" http://localhost:4000/api/auth

# With body
curl -X POST http://localhost:4000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice"}'
```

**Benefits:** Fast, no test framework needed.

**Drawbacks:** Manual, not repeatable.

---

### Strategy 2: Test Script

**Create `scripts/test-rules.sh`:**

```bash
#!/bin/bash
set -e

BASE="http://localhost:4000"

echo "Testing rules..."

# Test 1: Basic endpoint
response=$(curl -s "$BASE/api/hello")
echo "$response" | grep -q "message" || { echo "Test 1 failed"; exit 1; }

# Test 2: Auth required
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/auth/me")
[ "$status" = "401" ] || { echo "Test 2 failed"; exit 1; }

echo "All tests passed!"
```

**Run:**

```bash
chmod +x scripts/test-rules.sh
./scripts/test-rules.sh
```

---

### Strategy 3: Automated Testing with Vitest + Supertest

**Setup:**

```bash
pnpm add -D vitest supertest @types/supertest
```

**Test file: `tests/rules.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../main.js';

describe('Override Rules', () => {
  it('should return demo hello', async () => {
    const res = await request(app).get('/__demo/hello');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'hello');
  });

  it('should require auth for /api/auth/me', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should accept valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid-token-123');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email');
  });
});
```

**Add script to package.json:**

```json
{
  "scripts": {
    "test": "vitest"
  }
}
```

**Run:**

```bash
pnpm test
```

---

### Strategy 4: Contract Testing

**Principle:** Ensure overrides match real API contracts.

```typescript
// tests/contract.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../main.js';

describe('API Contract', () => {
  it('should match upstream response shape', async () => {
    // Get override response
    const override = await request(app).get('/api/users/1');

    // Expected shape (from API docs)
    expect(override.body).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      email: expect.any(String),
    });
  });
});
```

---

### Strategy 5: CI/CD Integration

**GitHub Actions example (`.github/workflows/test.yml`):**

```yaml
name: Test Rules

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install
      - run: pnpm test
      - run: npx tsc --noEmit  # Type check
```

---

## Performance Patterns

### Pattern 1: Rule Ordering for Performance

**Principle:** Place frequently matched rules first.

```
rules/
├── 01-popular.ts        # Matches 80% of requests
├── 02-common.ts         # Matches 15% of requests
└── 99-rare.ts           # Matches 5% of requests
```

**Why:** First match short-circuits the loop.

---

### Pattern 2: Pre-compile RegExp

❌ **Avoid:**

```typescript
export const User = rule({
  test: (req) => /^\/api\/users\/\d+$/.test(req.path),  // Compiled on every request
  handler: ...
});
```

✅ **Better:**

```typescript
const USER_PATH_REGEX = /^\/api\/users\/\d+$/;  // Compiled once

export const User = rule({
  test: (req) => USER_PATH_REGEX.test(req.path),
  handler: ...
});
```

**Or:** Use string path when possible (fastest).

```typescript
export const User = rule('GET', '/api/users/123', ...);  // Exact match
```

---

### Pattern 3: Lazy Data Loading

❌ **Avoid:**

```typescript
// Loads 10MB of data at startup
import largeDataset from './_data/huge.json';

export const Data = rule('GET', '/api/data', (req, res) => {
  res.json(largeDataset);
});
```

✅ **Better:**

```typescript
let cachedData: any = null;

export const Data = rule('GET', '/api/data', async (req, res) => {
  if (!cachedData) {
    // Load on first request
    const fs = await import('fs-extra');
    cachedData = await fs.readJson('./_data/huge.json');
  }
  res.json(cachedData);
});
```

---

### Pattern 4: Avoid Expensive Operations

❌ **Avoid:**

```typescript
export const Heavy = rule('GET', '/api/compute', (req, res) => {
  // Expensive computation on every request
  const result = Array.from({ length: 1000000 })
    .map((_, i) => i * i)
    .reduce((a, b) => a + b, 0);

  res.json({ result });
});
```

✅ **Better:**

```typescript
// Pre-compute at module load
const PRECOMPUTED = Array.from({ length: 1000000 })
  .map((_, i) => i * i)
  .reduce((a, b) => a + b, 0);

export const Heavy = rule('GET', '/api/compute', (req, res) => {
  res.json({ result: PRECOMPUTED });
});
```

---

### Pattern 5: Response Caching

```typescript
interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 60 seconds

export const Cached = rule('GET', '/api/expensive', async (req, res) => {
  const cacheKey = req.originalUrl;
  const now = Date.now();

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  // Compute expensive result
  await new Promise(resolve => setTimeout(resolve, 1000));
  const data = { result: Math.random(), timestamp: now };

  // Store in cache
  cache.set(cacheKey, { data, timestamp: now });

  res.json({ ...data, cached: false });
});
```

---

## Team Collaboration

### Pattern 1: Shared vs. Personal Rules

**Convention:**

```
rules/
├── shared/             # Team-wide rules (committed)
│   ├── auth.ts
│   └── products.ts
└── .personal/          # Personal rules (gitignored)
    ├── .alice/
    └── .bob/
```

**Add to `.gitignore`:**

```gitignore
rules/.personal/
rules/.*/
```

---

### Pattern 2: Documentation in Code

✅ **Good:**

```typescript
/**
 * UserDetail Rule
 *
 * Matches: GET /api/users/:id
 * Purpose: Mock user detail endpoint for demo purposes
 * Test: curl http://localhost:4000/api/users/42
 * Author: @alice
 * Created: 2025-01-15
 */
export const UserDetail = rule({
  methods: ['GET'],
  path: /^\/api\/users\/(\d+)$/,
  handler: (req, res) => {
    // Implementation...
  },
});
```

---

### Pattern 3: Code Review Checklist

**For PRs adding/modifying rules:**

- [ ] Rule name is descriptive
- [ ] Test commands provided in PR description
- [ ] No hardcoded secrets
- [ ] Error handling present (if async)
- [ ] Documented expected behavior
- [ ] No memory leaks (stateful rules have limits)
- [ ] Performance considered (pre-compile regex, avoid expensive ops)
- [ ] File placed in appropriate folder

---

### Pattern 4: Changelog for Rules

**Create `rules/CHANGELOG.md`:**

```markdown
# Rules Changelog

## 2025-01-15
- Added `UserDetail` rule for `/api/users/:id`
- Fixed `AuthToken` rule to handle expired tokens
- Archived `old-commerce/` rules to `.trash/2025-q1/`

## 2025-01-10
- Refactored `auth/` rules to use shared `_helpers/auth.ts`
```

---

## Version Control

### Pattern 1: What to Commit

✅ **Commit:**
- Rule files (`.ts`, `.js`)
- Shared helpers (`_helpers/`)
- Test data (`_data/`)
- Documentation (`README.md`, `CHANGELOG.md`)
- `.env.default` (non-sensitive defaults)

❌ **Don't commit:**
- `.env.local` (secrets)
- Personal rules (`.personal/`, `.wip/`)
- Large binary files
- Temporary test files

---

### Pattern 2: .gitignore

```gitignore
# Environment
.env.local

# Personal rules
rules/.personal/
rules/.wip/
rules/.*/

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp

# Build
dist/
build/

# Dependencies
node_modules/
```

---

### Pattern 3: Branch Strategy

**For large changes:**

```
main                   # Stable rules
├── feature/auth       # New auth rules
├── feature/commerce   # New commerce rules
└── fix/user-detail    # Bug fix
```

**Merge strategy:** Squash small commits, preserve history for large features.

---

### Pattern 4: Commit Messages

✅ **Good:**

```
feat(rules): add user detail mock for /api/users/:id

- Supports dynamic user IDs
- Returns mock user data
- Test: curl http://localhost:4000/api/users/42
```

❌ **Avoid:**

```
update stuff
fix
wip
```

---

## Refactoring Patterns

### Pattern 1: Extract Common Logic

**Before:**

```typescript
// Duplicated auth logic
export const Route1 = rule('GET', '/api/a', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== 'valid') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ data: 'A' });
});

export const Route2 = rule('GET', '/api/b', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== 'valid') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ data: 'B' });
});
```

**After:**

```typescript
// rules/_helpers/auth.ts
export function requireAuth(req: Request, res: Response): boolean {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== 'valid') {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// rules/routes.ts
import { requireAuth } from './_helpers/auth.js';

export const Route1 = rule('GET', '/api/a', (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json({ data: 'A' });
});

export const Route2 = rule('GET', '/api/b', (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json({ data: 'B' });
});
```

---

### Pattern 2: Split Large Rule Files

**Before:**

```typescript
// rules/users.ts - 500 lines, 10 exports
export const UserDetail = rule(...);
export const UserCreate = rule(...);
export const UserUpdate = rule(...);
// ... 7 more rules
```

**After:**

```
rules/users/
├── detail.ts
├── create.ts
├── update.ts
└── ... other files
```

---

### Pattern 3: Upgrade Legacy Patterns

**Old (deprecated name option):**

```typescript
export default rule({
  name: 'UserDetail',  // Deprecated
  path: '/api/users/1',
  handler: ...
});
```

**New (export name):**

```typescript
export const UserDetail = rule({
  path: '/api/users/1',
  handler: ...
});
```

---

## Security Patterns

### Pattern 1: Input Validation

✅ **Good:**

```typescript
export const CreateUser = rule('POST', '/api/users', (req, res) => {
  const { name, email, age } = req.body || {};

  // Validate inputs
  if (!name || typeof name !== 'string' || name.length > 100) {
    return res.status(400).json({ error: 'invalid_name' });
  }

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  if (age && (typeof age !== 'number' || age < 0 || age > 150)) {
    return res.status(400).json({ error: 'invalid_age' });
  }

  // Process valid input
  res.status(201).json({ id: Date.now(), name, email, age });
});
```

---

### Pattern 2: Secret Management

❌ **Never:**

```typescript
// Hardcoded secret
export const Auth = rule('POST', '/api/login', (req, res) => {
  if (req.body.password === 'my-secret-password-123') {  // BAD!
    return res.json({ token: 'valid' });
  }
  res.status(401).json({ error: 'unauthorized' });
});
```

✅ **Always:**

```typescript
// Use environment variable
const VALID_PASSWORD = process.env['TEST_PASSWORD'] || 'default-test-pass';

export const Auth = rule('POST', '/api/login', (req, res) => {
  if (req.body.password === VALID_PASSWORD) {
    return res.json({ token: 'valid' });
  }
  res.status(401).json({ error: 'unauthorized' });
});
```

---

### Pattern 3: CORS Configuration

**In `.env.local`:**

```bash
# Restrict to specific origins
CORS_ORIGINS=http://localhost:3000,https://dev.example.com
```

**In code:**

```typescript
// main.ts already handles this via cors middleware
// No need to modify rules
```

---

### Pattern 4: Rate Limiting Simulation

```typescript
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export const RateLimited = rule('GET', '/api/limited', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const limit = 10;
  const windowMs = 60000; // 1 minute

  let record = requestCounts.get(ip);

  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + windowMs };
    requestCounts.set(ip, record);
  }

  record.count++;

  if (record.count > limit) {
    return res.status(429).json({
      error: 'rate_limit_exceeded',
      retryAfter: Math.ceil((record.resetAt - now) / 1000),
    });
  }

  res.json({ ok: true, remaining: limit - record.count });
});
```

---

## Migration Patterns

### Pattern 1: From MSW to override-proxy

**MSW handler:**

```typescript
// src/mocks/handlers.ts
import { rest } from 'msw';

export const handlers = [
  rest.get('/api/users/:id', (req, res, ctx) => {
    const { id } = req.params;
    return res(
      ctx.status(200),
      ctx.json({ id, name: `User ${id}` })
    );
  }),
];
```

**Override-proxy equivalent:**

```typescript
// rules/users.ts
import { rule } from '../utils.js';

export const UserDetail = rule({
  methods: ['GET'],
  path: /^\/api\/users\/(\d+)$/,
  handler: (req, res) => {
    const match = req.path.match(/^\/api\/users\/(\d+)$/);
    const id = match ? match[1] : 'unknown';
    res.status(200).json({ id, name: `User ${id}` });
  },
});
```

**Migration steps:**
1. Copy MSW handlers one-by-one to `rules/`
2. Convert `rest.get/post/...` to `rule(method, path, handler)`
3. Convert `req.params` to regex captures or `req.query`
4. Replace `ctx.status()` with `res.status()`
5. Replace `ctx.json()` with `res.json()`
6. Test each rule before removing MSW handler

---

### Pattern 2: Gradual Migration

**Hybrid approach:**

```typescript
// Keep MSW for unit tests (deterministic)
// Use override-proxy for integration/dev (realistic)

// package.json
{
  "scripts": {
    "test:unit": "vitest",           // Uses MSW
    "test:integration": "start-server-and-test dev http://localhost:4000 'vitest run integration'",  // Uses override-proxy
    "dev": "nodemon"                  // Uses override-proxy
  }
}
```

---

## Quick Reference

### Checklist: Before Committing a New Rule

- [ ] Rule name is descriptive and follows convention
- [ ] File placed in correct folder
- [ ] Export uses recommended pattern (`export const RuleName = ...`)
- [ ] Test function returns boolean
- [ ] Async handlers use `async/await` correctly
- [ ] No hardcoded secrets
- [ ] Error handling present (try-catch for async)
- [ ] Tested manually with curl
- [ ] Added entry to `rules/CHANGELOG.md` (if applicable)
- [ ] No memory leaks (stateful rules have limits)

---

### Checklist: Rule Not Working?

1. [ ] Is file in `rules/` (not dotfile/folder)?
2. [ ] Is export valid (`export const/default`)?
3. [ ] Is rule listed in startup logs?
4. [ ] Does `test()` function return `true`?
5. [ ] Does `methods` array include request method?
6. [ ] Is path/regex correct (check with `req.path`)?
7. [ ] Is rule ordered correctly (specific before generic)?
8. [ ] Any errors in server console?

---

### Checklist: Performance Issue?

1. [ ] Are frequently-matched rules first?
2. [ ] Are RegExps pre-compiled (not in-line)?
3. [ ] Are expensive operations avoided in handlers?
4. [ ] Is caching used for heavy computations?
5. [ ] Is data loading lazy (not at startup)?
6. [ ] Are stateful rules bounded (no memory leaks)?

