# Migrate from MSW

Convert Mock Service Worker (MSW) handlers to override-proxy rules.

## Invocation

Users can invoke this command by:
- `/migrate-from-msw` - Interactive mode (browse for handlers file)
- `/migrate-from-msw <filepath>` - Convert specific MSW handlers file
- `/migrate-from-msw --all` - Find and convert all MSW files in project

## Behavior

When invoked, this command:

### Phase 1: Discovery
1. **Find MSW files** - Search for:
   - `src/mocks/handlers.ts|js`
   - `**/mocks/handlers.*`
   - Files importing from `msw`

2. **Parse MSW code** - Extract handlers:
   - `rest.get()`, `rest.post()`, etc.
   - `graphql.query()`, `graphql.mutation()`
   - Handler parameters and responses

### Phase 2: Conversion
3. **Transform syntax** - Convert:
   - MSW imports → override-proxy imports
   - `rest.METHOD()` → `rule()`
   - `req.params` → regex captures
   - `ctx.status()` → `res.status()`
   - `ctx.json()` → `res.json()`
   - `ctx.delay()` → async/await

4. **Generate rule files** - Create:
   - One file per handler (or group related)
   - Proper naming and organization
   - Comments noting original MSW code

### Phase 3: Verification
5. **Create migration checklist** - Track:
   - Handlers converted
   - Handlers skipped (manual intervention needed)
   - Test commands for each rule

6. **Generate migration guide** - Document:
   - What changed
   - How to test
   - What to do with original MSW files

## Conversion Mappings

From docs/PATTERNS.md "Migration Patterns":

### Basic Handler Conversion

**MSW:**
```typescript
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

**override-proxy:**
```typescript
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

### Conversion Rules

| MSW Syntax | override-proxy Equivalent | Notes |
|------------|---------------------------|-------|
| `rest.get(path, handler)` | `rule('GET', path, handler)` | Simple form |
| `rest.post(path, handler)` | `rule('POST', path, handler)` | |
| `req.params.id` | Regex capture group | Extract from `req.path.match()` |
| `req.params.*` | `req.query.*` (if query) | Query params work same way |
| `req.body` | `req.body` | Same (needs body-parser) |
| `ctx.status(200)` | `res.status(200)` | Direct mapping |
| `ctx.json(data)` | `res.json(data)` | Direct mapping |
| `ctx.delay(1000)` | `await new Promise(r => setTimeout(r, 1000))` | Add async |
| `ctx.text(str)` | `res.send(str)` | Plain text |
| `ctx.xml(str)` | `res.type('xml').send(str)` | Set content type |
| `return res(...)` | Just call `res.*()` | No return needed |

### Path Parameter Conversion

**MSW path params** → **RegExp captures**

| MSW Pattern | override-proxy RegExp | Extract Code |
|-------------|----------------------|--------------|
| `/users/:id` | `/^\/users\/(\d+)$/` | `req.path.match(/^\/users\/(\d+)$/)[1]` |
| `/posts/:postId/comments/:commentId` | `/^\/posts\/(\d+)\/comments\/(\d+)$/` | `const [, postId, commentId] = req.path.match(...)` |
| `/files/:filename` | `/^\/files\/([^\/]+)$/` | `req.path.match(/^\/files\/([^\/]+)$/)[1]` |

### Special Cases

#### 1. Conditional Responses (MSW)
```typescript
rest.get('/api/user', (req, res, ctx) => {
  const token = req.headers.get('Authorization');

  if (!token) {
    return res(ctx.status(401), ctx.json({ error: 'Unauthorized' }));
  }

  return res(ctx.status(200), ctx.json({ user: '...' }));
});
```

#### 1. Conditional Responses (override-proxy)
```typescript
export const UserAuth = rule('GET', '/api/user', (req, res) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.status(200).json({ user: '...' });
});
```

#### 2. Delays (MSW)
```typescript
rest.get('/api/slow', (req, res, ctx) => {
  return res(
    ctx.delay(2000),
    ctx.json({ data: 'slow' })
  );
});
```

#### 2. Delays (override-proxy)
```typescript
export const SlowEndpoint = rule('GET', '/api/slow', async (req, res) => {
  await new Promise(resolve => setTimeout(resolve, 2000));
  res.json({ data: 'slow' });
});
```

#### 3. GraphQL (MSW)
```typescript
graphql.query('GetUser', (req, res, ctx) => {
  return res(
    ctx.data({
      user: { id: 1, name: 'John' }
    })
  );
});
```

#### 3. GraphQL (override-proxy)
```typescript
export const GraphQLGetUser = rule('POST', '/graphql', (req, res) => {
  const { query } = req.body;

  if (query.includes('GetUser')) {
    return res.json({
      data: {
        user: { id: 1, name: 'John' }
      }
    });
  }

  res.status(400).json({ errors: [{ message: 'Unknown query' }] });
});
```

## Automated Conversion Process

```typescript
interface MSWHandler {
  method: string;
  path: string;
  handler: string; // Full handler code
  hasParams: boolean;
  usesDelay: boolean;
  usesCtx: string[]; // ['status', 'json', 'delay']
}

async function parseMSWFile(filepath: string): Promise<MSWHandler[]> {
  const content = await readFile(filepath);
  const handlers: MSWHandler[] = [];

  // Find all rest.* calls
  const handlerRegex = /rest\.(get|post|put|patch|delete)\(([^,]+),\s*(\([^)]+\)\s*=>[^}]+})\s*\)/g;

  let match;
  while ((match = handlerRegex.exec(content)) !== null) {
    const [, method, pathStr, handlerCode] = match;

    handlers.push({
      method: method.toUpperCase(),
      path: pathStr.replace(/['"]/g, ''),
      handler: handlerCode,
      hasParams: /:(\w+)/.test(pathStr),
      usesDelay: /ctx\.delay/.test(handlerCode),
      usesCtx: extractCtxUsage(handlerCode)
    });
  }

  return handlers;
}

function convertHandler(msw: MSWHandler): string {
  let code = '';

  // Convert path with params to regex
  let path = msw.path;
  if (msw.hasParams) {
    path = convertPathToRegex(msw.path);
  }

  // Start rule definition
  code += `export const ${generateRuleName(msw.path)} = rule({\n`;
  code += `  methods: ['${msw.method}'],\n`;
  code += `  path: ${path},\n`;

  // Convert handler
  if (msw.usesDelay) {
    code += `  handler: async (req, res) => {\n`;
  } else {
    code += `  handler: (req, res) => {\n`;
  }

  // Convert body
  let handlerBody = msw.handler;

  // Convert params
  if (msw.hasParams) {
    handlerBody = convertParams(handlerBody, msw.path);
  }

  // Convert ctx.* calls
  handlerBody = handlerBody.replace(/ctx\.status\((\d+)\)/g, 'res.status($1)');
  handlerBody = handlerBody.replace(/ctx\.json\(([^)]+)\)/g, 'res.json($1)');
  handlerBody = handlerBody.replace(/ctx\.delay\((\d+)\)/g, 'await new Promise(r => setTimeout(r, $1))');

  // Remove return res(...)
  handlerBody = handlerBody.replace(/return res\([^)]+\);/g, '');

  code += handlerBody;
  code += `  }\n`;
  code += `});\n`;

  return code;
}

function convertPathToRegex(path: string): string {
  // Convert :param to (\w+) or (\d+)
  const regex = path
    .replace(/\//g, '\\/')
    .replace(/:(\w+)/g, (_, name) => {
      // If param looks like id, use \d+
      if (name.toLowerCase().includes('id')) {
        return '(\\d+)';
      }
      return '([^\/]+)';
    });

  return `/^${regex}$/`;
}

function convertParams(code: string, path: string): string {
  const params = [...path.matchAll(/:(\w+)/g)].map(m => m[1]);

  // Add extraction code at the start
  let extraction = `const match = req.path.match(${convertPathToRegex(path)});\n`;

  params.forEach((param, i) => {
    extraction += `    const ${param} = match ? match[${i + 1}] : 'unknown';\n`;
  });

  // Replace req.params.* references
  let converted = code;
  params.forEach(param => {
    converted = converted.replace(
      new RegExp(`req\\.params\\.${param}`, 'g'),
      param
    );
  });

  return extraction + converted;
}
```

## Output Format

### Migration Report

```markdown
# MSW to override-proxy Migration Report

## Summary
- Source: src/mocks/handlers.ts
- Handlers found: 12
- Converted: 10 ✅
- Manual review needed: 2 ⚠️

## Converted Handlers

### ✅ GET /api/users/:id → UserDetail
- File: rules/users/detail.ts
- Status: Converted successfully
- Test: `curl http://localhost:4000/api/users/123`

### ✅ POST /api/login → LoginAuth
- File: rules/auth/login.ts
- Status: Converted successfully
- Test: `curl -X POST http://localhost:4000/api/login -d '{"email":"...","password":"..."}'`

## Manual Review Needed

### ⚠️ GraphQL /graphql
- Reason: Complex query parsing needed
- Original: src/mocks/handlers.ts:45-60
- Suggestion: See docs/EXAMPLES.md Example 23 for GraphQL pattern

### ⚠️ WebSocket /ws
- Reason: WebSocket not supported by override-proxy
- Original: src/mocks/handlers.ts:62-70
- Suggestion: Use dedicated WebSocket mock library

## Migration Checklist

- [ ] Review all converted rules
- [ ] Test each rule (commands above)
- [ ] Update MSW imports in test files (if keeping MSW for tests)
- [ ] Consider archiving original MSW handlers
- [ ] Update documentation/README

## Next Steps

1. Restart server: `pnpm dev`
2. Verify rules loaded (check startup logs)
3. Run tests: `./scripts/test-all.sh`
4. Update team on new workflow

## Keeping Both MSW and override-proxy

You can keep MSW for unit tests and use override-proxy for dev:

**package.json:**
```json
{
  "scripts": {
    "test": "vitest",              // Uses MSW
    "dev": "nodemon",               // Uses override-proxy
    "test:integration": "..."       // Uses override-proxy
  }
}
```

See docs/PATTERNS.md "Gradual Migration" for details.
```

## Example Interaction

```
User: /migrate-from-msw src/mocks/handlers.ts