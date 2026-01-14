# Examples Library

Practical, copy-paste-ready examples organized by scenario. Each example includes full code, test commands, and expected output.


## Basic Examples

### 1. Simple Path Match

**Scenario:** Mock a single endpoint with static data.

```typescript
// rules/basic/hello.ts
import { rule } from '../../utils.js';

export const Hello = rule('GET', '/api/hello', (_req, res) => {
  res.json({ message: 'Hello from override!', timestamp: Date.now() });
});
```

**Test:**

```bash
curl http://localhost:4000/api/hello
```

**Expected Output:**

```json
{
  "message": "Hello from override!",
  "timestamp": 1704067200000
}
```

---

### 2. Multiple HTTP Methods

**Scenario:** Handle GET and POST differently on the same path.

```typescript
// rules/basic/item.ts
import { rule } from '../../utils.js';

export const GetItem = rule('GET', '/api/item', (_req, res) => {
  res.json({ id: 1, name: 'Item 1', status: 'active' });
});

export const CreateItem = rule('POST', '/api/item', (req, res) => {
  const body = req.body || {};
  res.status(201).json({
    id: Date.now(),
    name: body.name || 'New Item',
    status: 'created',
  });
});
```

**Test:**

```bash
# GET
curl http://localhost:4000/api/item

# POST (requires body-parser middleware if parsing JSON)
curl -X POST http://localhost:4000/api/item \
  -H "Content-Type: application/json" \
  -d '{"name":"My Item"}'
```

---

### 3. RegExp Path with Capture Groups

**Scenario:** Match dynamic path segments (e.g., `/api/users/123`).

```typescript
// rules/basic/user-detail.ts
import { rule } from '../../utils.js';

export const UserDetail = rule({
  methods: ['GET'],
  path: /^\/api\/users\/(\d+)$/,
  handler: (req, res) => {
    const match = req.path.match(/^\/api\/users\/(\d+)$/);
    const userId = match ? match[1] : 'unknown';

    res.json({
      id: userId,
      name: `User ${userId}`,
      email: `user${userId}@example.com`,
      source: 'override',
    });
  },
});
```

**Test:**

```bash
curl http://localhost:4000/api/users/42
```

**Expected Output:**

```json
{
  "id": "42",
  "name": "User 42",
  "email": "user42@example.com",
  "source": "override"
}
```

---

### 4. Query Parameter Filtering

**Scenario:** Match based on query string.

```typescript
// rules/basic/feature-flag.ts
import { rule } from '../../utils.js';

export const FeatureFlag = rule({
  methods: ['GET'],
  test: (req) =>
    req.path === '/api/features' && req.query['mock'] === 'true',
  handler: (_req, res) => {
    res.json({
      features: {
        darkMode: true,
        betaUI: true,
        aiAssist: false,
      },
      note: 'Mocked feature flags',
    });
  },
});
```

**Test:**

```bash
# This will match
curl "http://localhost:4000/api/features?mock=true"

# This will proxy to upstream
curl "http://localhost:4000/api/features"
```

---

## Authentication & Authorization

### 5. Mock JWT Authentication

**Scenario:** Validate Authorization header and return user info.

```typescript
// rules/auth/jwt-mock.ts
import { rule } from '../../utils.js';

export const JWTAuth = rule({
  methods: ['GET'],
  path: '/api/auth/me',
  handler: (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing token' });
    }

    const token = authHeader.replace('Bearer ', '');

    // Mock token validation (in real world, verify JWT signature)
    if (token === 'valid-token-123') {
      return res.json({
        id: 1,
        email: 'user@example.com',
        name: 'Test User',
        roles: ['user', 'admin'],
      });
    }

    return res.status(403).json({ error: 'forbidden', message: 'Invalid token' });
  },
});
```

**Test:**

```bash
# Valid token
curl http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer valid-token-123"

# Invalid token
curl http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer invalid"

# Missing token
curl http://localhost:4000/api/auth/me
```

---

### 6. API Key Validation

**Scenario:** Check custom header for API key.

```typescript
// rules/auth/api-key.ts
import { rule } from '../../utils.js';

const VALID_KEYS = ['key-alpha', 'key-beta', 'key-gamma'];

export const APIKeyAuth = rule({
  methods: ['GET', 'POST'],
  test: (req) => req.path.startsWith('/api/v1/'),
  handler: (req, res, next) => {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({ error: 'missing_api_key' });
    }

    if (!VALID_KEYS.includes(apiKey)) {
      return res.status(403).json({ error: 'invalid_api_key' });
    }

    // Valid key - pass through to next middleware or proxy
    next();
  },
});
```

**Test:**

```bash
# Valid key - will proxy to upstream
curl http://localhost:4000/api/v1/data \
  -H "x-api-key: key-alpha"

# Invalid key
curl http://localhost:4000/api/v1/data \
  -H "x-api-key: wrong-key"
```

---

### 7. Role-Based Access Control

**Scenario:** Different responses based on user role.

```typescript
// rules/auth/rbac.ts
import { rule } from '../../utils.js';

export const AdminEndpoint = rule({
  methods: ['GET'],
  path: '/api/admin/stats',
  handler: (req, res) => {
    const userRole = req.headers['x-user-role'] as string;

    if (userRole !== 'admin') {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    res.json({
      totalUsers: 1523,
      activeUsers: 892,
      revenue: 45230.5,
      serverLoad: 0.67,
    });
  },
});
```

**Test:**

```bash
# Admin access
curl http://localhost:4000/api/admin/stats \
  -H "x-user-role: admin"

# User access (denied)
curl http://localhost:4000/api/admin/stats \
  -H "x-user-role: user"
```

---

## Data Transformation

### 8. Add Fields to Upstream Response

**Scenario:** Proxy to upstream but add extra fields to the response.

```typescript
// rules/transform/add-fields.ts
import { rule } from '../../utils.js';

export const AddTimestamp = rule({
  methods: ['GET'],
  path: '/api/pokemon/pikachu',
  handler: async (req, res) => {
    // Fetch from upstream
    const upstream = process.env['PROXY_TARGET'] || 'https://pokeapi.co/api/v2/';
    const response = await fetch(`${upstream}pokemon/pikachu`);
    const data = await response.json();

    // Add custom fields
    res.json({
      ...data,
      _meta: {
        source: 'override-proxy',
        timestamp: new Date().toISOString(),
        cached: false,
      },
    });
  },
});
```

**Test:**

```bash
curl http://localhost:4000/api/pokemon/pikachu
```

**Note:** Response will have original data plus `_meta` field.

---

### 9. Filter and Transform Data

**Scenario:** Reduce payload size by filtering fields.

```typescript
// rules/transform/filter-fields.ts
import { rule } from '../../utils.js';

export const FilterUserData = rule({
  methods: ['GET'],
  path: '/api/users/list',
  handler: (_req, res) => {
    // Simulate full data
    const fullData = [
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        password: 'hashed',
        ssn: '123-45-6789',
        internalNote: 'VIP customer',
      },
      {
        id: 2,
        name: 'Bob',
        email: 'bob@example.com',
        password: 'hashed',
        ssn: '987-65-4321',
        internalNote: 'Regular',
      },
    ];

    // Filter sensitive fields
    const publicData = fullData.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }));

    res.json({ users: publicData });
  },
});
```

**Test:**

```bash
curl http://localhost:4000/api/users/list
```

**Expected Output:**

```json
{
  "users": [
    { "id": 1, "name": "Alice", "email": "alice@example.com" },
    { "id": 2, "name": "Bob", "email": "bob@example.com" }
  ]
}
```

---

### 10. Aggregate Multiple Endpoints

**Scenario:** Combine data from multiple sources into one response.

```typescript
// rules/transform/aggregate.ts
import { rule } from '../../utils.js';

export const Dashboard = rule({
  methods: ['GET'],
  path: '/api/dashboard',
  handler: async (_req, res) => {
    // Simulate fetching from multiple sources
    const [userStats, orderStats, systemHealth] = await Promise.all([
      Promise.resolve({ totalUsers: 1500, activeNow: 230 }),
      Promise.resolve({ ordersToday: 45, revenue: 3200.5 }),
      Promise.resolve({ status: 'healthy', uptime: '99.9%' }),
    ]);

    res.json({
      dashboard: {
        users: userStats,
        orders: orderStats,
        system: systemHealth,
        generatedAt: new Date().toISOString(),
      },
    });
  },
});
```

**Test:**

```bash
curl http://localhost:4000/api/dashboard
```

---

## Conditional Proxying

### 11. Header-Based Bypass

**Scenario:** Use header to toggle mock on/off.

```typescript
// rules/conditional/mock-toggle.ts
import { rule } from '../../utils.js';

export const ConditionalMock = rule({
  methods: ['GET'],
  path: '/api/data',
  handler: (req, res, next) => {
    // Check for mock header
    if (req.headers['x-use-mock'] === '1') {
      return res.json({ data: 'mocked', source: 'override' });
    }

    // Pass through to upstream
    next();
  },
});
```

**Test:**

```bash
# Get mocked response
curl http://localhost:4000/api/data \
  -H "x-use-mock: 1"

# Proxy to upstream
curl http://localhost:4000/api/data
```

---

### 12. A/B Testing Simulation

**Scenario:** Return different variants based on user ID.

```typescript
// rules/conditional/ab-test.ts
import { rule } from '../../utils.js';

export const ABTest = rule({
  methods: ['GET'],
  path: '/api/feature/new-ui',
  handler: (req, res) => {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(400).json({ error: 'missing_user_id' });
    }

    // Simple hash: even user IDs get variant A, odd get variant B
    const variant = parseInt(userId, 10) % 2 === 0 ? 'A' : 'B';

    res.json({
      variant,
      features: variant === 'A'
        ? { newUI: false, legacyMode: true }
        : { newUI: true, legacyMode: false },
    });
  },
});
```

**Test:**

```bash
# User 100 (even) -> Variant A
curl http://localhost:4000/api/feature/new-ui \
  -H "x-user-id: 100"

# User 101 (odd) -> Variant B
curl http://localhost:4000/api/feature/new-ui \
  -H "x-user-id: 101"
```

---

### 13. Feature Flag Override

**Scenario:** Override feature flags for testing.

```typescript
// rules/conditional/feature-flags.ts
import { rule } from '../../utils.js';

const DEFAULT_FLAGS = {
  darkMode: false,
  newCheckout: false,
  aiRecommendations: false,
};

export const FeatureFlags = rule({
  methods: ['GET'],
  path: '/api/flags',
  handler: (req, res, next) => {
    const override = req.query['override'];

    if (!override) {
      // No override - proxy to real flags service
      return next();
    }

    // Parse override flags from query string
    const overrideFlags = (override as string).split(',').reduce((acc, flag) => {
      acc[flag] = true;
      return acc;
    }, {} as Record<string, boolean>);

    res.json({
      ...DEFAULT_FLAGS,
      ...overrideFlags,
      source: 'override',
    });
  },
});
```

**Test:**

```bash
# Enable specific flags
curl "http://localhost:4000/api/flags?override=darkMode,aiRecommendations"

# No override - proxy to upstream
curl "http://localhost:4000/api/flags"
```

---

## Error Simulation

### 14. Simulate 4xx Errors

**Scenario:** Test error handling in client apps.

```typescript
// rules/errors/client-errors.ts
import { rule } from '../../utils.js';

export const BadRequest = rule('POST', '/api/test/400', (_req, res) => {
  res.status(400).json({
    error: 'bad_request',
    message: 'Invalid input data',
    details: ['Field "email" is required', 'Field "age" must be a number'],
  });
});

export const Unauthorized = rule('GET', '/api/test/401', (_req, res) => {
  res.status(401).json({
    error: 'unauthorized',
    message: 'Authentication required',
  });
});

export const Forbidden = rule('GET', '/api/test/403', (_req, res) => {
  res.status(403).json({
    error: 'forbidden',
    message: 'Insufficient permissions',
  });
});

export const NotFound = rule('GET', '/api/test/404', (_req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: 'Resource does not exist',
  });
});
```

**Test:**

```bash
curl http://localhost:4000/api/test/400 -X POST
curl http://localhost:4000/api/test/401
curl http://localhost:4000/api/test/403
curl http://localhost:4000/api/test/404
```

---

### 15. Simulate 5xx Errors

**Scenario:** Test server error handling.

```typescript
// rules/errors/server-errors.ts
import { rule } from '../../utils.js';

export const InternalError = rule('GET', '/api/test/500', (_req, res) => {
  res.status(500).json({
    error: 'internal_server_error',
    message: 'An unexpected error occurred',
    requestId: `req_${Date.now()}`,
  });
});

export const ServiceUnavailable = rule('GET', '/api/test/503', (_req, res) => {
  res.status(503).json({
    error: 'service_unavailable',
    message: 'Service temporarily unavailable',
    retryAfter: 60,
  });
});

export const GatewayTimeout = rule('GET', '/api/test/504', async (_req, res) => {
  // Simulate timeout
  await new Promise((resolve) => setTimeout(resolve, 5000));
  res.status(504).json({
    error: 'gateway_timeout',
    message: 'Upstream service did not respond in time',
  });
});
```

**Test:**

```bash
curl http://localhost:4000/api/test/500
curl http://localhost:4000/api/test/503
curl http://localhost:4000/api/test/504  # Will take 5 seconds
```

---

### 16. Random Failure Injection

**Scenario:** Randomly fail to test retry logic.

```typescript
// rules/errors/chaos.ts
import { rule } from '../../utils.js';

export const RandomFailure = rule({
  methods: ['GET'],
  path: '/api/unstable',
  handler: (_req, res) => {
    // 30% chance of failure
    if (Math.random() < 0.3) {
      return res.status(500).json({
        error: 'random_failure',
        message: 'Simulated random failure',
      });
    }

    res.json({ status: 'ok', data: 'Success!' });
  },
});
```

**Test:**

```bash
# Run multiple times to see random failures
for i in {1..10}; do
  curl http://localhost:4000/api/unstable
  echo ""
done
```

---

## Latency Injection

### 17. Fixed Delay

**Scenario:** Simulate slow API responses.

```typescript
// rules/latency/fixed-delay.ts
import { rule } from '../../utils.js';

export const SlowEndpoint = rule({
  methods: ['GET'],
  path: '/api/slow',
  handler: async (_req, res) => {
    // Wait 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));

    res.json({
      message: 'This response was delayed by 2 seconds',
      timestamp: Date.now(),
    });
  },
});
```

**Test:**

```bash
time curl http://localhost:4000/api/slow
```

---

### 18. Random Latency

**Scenario:** Simulate variable network conditions.

```typescript
// rules/latency/random-delay.ts
import { rule } from '../../utils.js';

export const VariableLatency = rule({
  methods: ['GET'],
  path: '/api/variable',
  handler: async (_req, res) => {
    // Random delay between 100ms and 3000ms
    const delay = Math.floor(Math.random() * 2900) + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));

    res.json({
      message: 'Response with variable latency',
      delayMs: delay,
      timestamp: Date.now(),
    });
  },
});
```

**Test:**

```bash
# Run multiple times to see varying delays
for i in {1..5}; do
  time curl http://localhost:4000/api/variable
  echo ""
done
```

---

### 19. Per-Endpoint Latency Configuration

**Scenario:** Configure different delays for different endpoints.

```typescript
// rules/latency/configured-delay.ts
import { rule } from '../../utils.js';

const LATENCY_CONFIG: Record<string, number> = {
  '/api/fast': 50,
  '/api/medium': 500,
  '/api/slow': 2000,
};

function createDelayedEndpoint(path: string) {
  return rule({
    methods: ['GET'],
    path,
    handler: async (_req, res) => {
      const delay = LATENCY_CONFIG[path] || 0;
      await new Promise((resolve) => setTimeout(resolve, delay));

      res.json({
        path,
        delayMs: delay,
        timestamp: Date.now(),
      });
    },
  });
}

export const FastEndpoint = createDelayedEndpoint('/api/fast');
export const MediumEndpoint = createDelayedEndpoint('/api/medium');
export const SlowEndpoint = createDelayedEndpoint('/api/slow');
```

**Test:**

```bash
time curl http://localhost:4000/api/fast    # ~50ms
time curl http://localhost:4000/api/medium  # ~500ms
time curl http://localhost:4000/api/slow    # ~2000ms
```

---

## Stateful Mocks

### 20. In-Memory State

**Scenario:** Maintain state across requests (simple CRUD).

```typescript
// rules/stateful/todo-list.ts
import { rule } from '../../utils.js';

interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: number;
}

// In-memory store (resets on server restart)
let todos: Todo[] = [
  { id: 1, title: 'Learn override-proxy', completed: false, createdAt: Date.now() },
];
let nextId = 2;

export const ListTodos = rule('GET', '/api/todos', (_req, res) => {
  res.json({ todos, count: todos.length });
});

export const CreateTodo = rule('POST', '/api/todos', (req, res) => {
  const { title } = req.body || {};

  if (!title) {
    return res.status(400).json({ error: 'title_required' });
  }

  const newTodo: Todo = {
    id: nextId++,
    title,
    completed: false,
    createdAt: Date.now(),
  };

  todos.push(newTodo);
  res.status(201).json(newTodo);
});

export const UpdateTodo = rule({
  methods: ['PATCH'],
  path: /^\/api\/todos\/(\d+)$/,
  handler: (req, res) => {
    const match = req.path.match(/^\/api\/todos\/(\d+)$/);
    const id = match ? parseInt(match[1], 10) : -1;

    const todo = todos.find((t) => t.id === id);
    if (!todo) {
      return res.status(404).json({ error: 'todo_not_found' });
    }

    const { title, completed } = req.body || {};
    if (title !== undefined) todo.title = title;
    if (completed !== undefined) todo.completed = completed;

    res.json(todo);
  },
});

export const DeleteTodo = rule({
  methods: ['DELETE'],
  path: /^\/api\/todos\/(\d+)$/,
  handler: (req, res) => {
    const match = req.path.match(/^\/api\/todos\/(\d+)$/);
    const id = match ? parseInt(match[1], 10) : -1;

    const index = todos.findIndex((t) => t.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'todo_not_found' });
    }

    todos.splice(index, 1);
    res.status(204).send();
  },
});
```

**Test:**

```bash
# List todos
curl http://localhost:4000/api/todos

# Create todo
curl -X POST http://localhost:4000/api/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"Buy milk"}'

# Update todo (mark completed)
curl -X PATCH http://localhost:4000/api/todos/1 \
  -H "Content-Type: application/json" \
  -d '{"completed":true}'

# Delete todo
curl -X DELETE http://localhost:4000/api/todos/1
```

---

## Advanced Scenarios

### 21. Pagination

**Scenario:** Mock paginated API responses.

```typescript
// rules/advanced/pagination.ts
import { rule } from '../../utils.js';

const ITEMS = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
  value: Math.random() * 1000,
}));

export const PaginatedList = rule({
  methods: ['GET'],
  path: '/api/items',
  handler: (req, res) => {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '10', 10);

    const start = (page - 1) * limit;
    const end = start + limit;
    const items = ITEMS.slice(start, end);

    const totalPages = Math.ceil(ITEMS.length / limit);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total: ITEMS.length,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  },
});
```

**Test:**

```bash
# First page
curl "http://localhost:4000/api/items?page=1&limit=10"

# Second page
curl "http://localhost:4000/api/items?page=2&limit=10"

# Custom page size
curl "http://localhost:4000/api/items?page=1&limit=25"
```

---

### 22. File Download Simulation

**Scenario:** Return file content with proper headers.

```typescript
// rules/advanced/file-download.ts
import { rule } from '../../utils.js';

export const DownloadCSV = rule('GET', '/api/export/users.csv', (_req, res) => {
  const csv = `id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com
3,Charlie,charlie@example.com`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
  res.send(csv);
});

export const DownloadJSON = rule('GET', '/api/export/data.json', (_req, res) => {
  const data = {
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
    exportedAt: new Date().toISOString(),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="data.json"');
  res.json(data);
});
```

**Test:**

```bash
curl -O http://localhost:4000/api/export/users.csv
curl -O http://localhost:4000/api/export/data.json
```

---

### 23. GraphQL Mock

**Scenario:** Mock GraphQL endpoint with query parsing.

```typescript
// rules/advanced/graphql.ts
import { rule } from '../../utils.js';

export const GraphQLEndpoint = rule({
  methods: ['POST'],
  path: '/graphql',
  handler: (req, res) => {
    const { query, variables } = req.body || {};

    // Simple query matching (in real world, parse AST)
    if (query?.includes('query GetUser')) {
      const userId = variables?.id || 1;
      return res.json({
        data: {
          user: {
            id: userId,
            name: `User ${userId}`,
            email: `user${userId}@example.com`,
          },
        },
      });
    }

    if (query?.includes('mutation CreatePost')) {
      return res.json({
        data: {
          createPost: {
            id: Date.now(),
            title: variables?.title || 'Untitled',
            author: { id: 1, name: 'Alice' },
          },
        },
      });
    }

    res.status(400).json({ errors: [{ message: 'Unknown query' }] });
  },
});
```

**Test:**

```bash
# Query
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query GetUser($id: ID!) { user(id: $id) { id name email } }",
    "variables": {"id": 42}
  }'

# Mutation
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation CreatePost($title: String!) { createPost(title: $title) { id title } }",
    "variables": {"title": "My Post"}
  }'
```

---

### 24. WebSocket Upgrade Blocker

**Scenario:** Block WebSocket connections or return mock response.

```typescript
// rules/advanced/websocket.ts
import { rule } from '../../utils.js';

export const WebSocketBlock = rule({
  methods: ['GET'],
  test: (req) =>
    req.path === '/ws' && req.headers.upgrade === 'websocket',
  handler: (_req, res) => {
    res.status(400).json({
      error: 'websocket_not_supported',
      message: 'WebSocket connections are disabled in mock mode',
    });
  },
});
```

**Note:** override-proxy is HTTP-based; for real WebSocket mocking, consider dedicated tools.

---

## Multi-Rule Coordination

### 25. Fallback Chain

**Scenario:** Multiple rules with increasing specificity.

```typescript
// rules/coordination/fallback.ts
import { rule } from '../../utils.js';

// Most specific - matches first
export const SpecialUser = rule({
  methods: ['GET'],
  path: /^\/api\/users\/999$/,
  handler: (_req, res) => {
    res.json({
      id: 999,
      name: 'Super Admin',
      role: 'admin',
      special: true,
    });
  },
});

// Less specific - matches if above doesn't
export const RegularUser = rule({
  methods: ['GET'],
  path: /^\/api\/users\/(\d+)$/,
  handler: (req, res) => {
    const match = req.path.match(/^\/api\/users\/(\d+)$/);
    const id = match ? match[1] : 'unknown';

    res.json({
      id,
      name: `User ${id}`,
      role: 'user',
    });
  },
});
```

**Test:**

```bash
# Matches SpecialUser (first rule)
curl http://localhost:4000/api/users/999

# Matches RegularUser (second rule)
curl http://localhost:4000/api/users/123
```

**Note:** Rule order matters! Place specific rules before generic ones.

---

### 26. Shared Utilities

**Scenario:** Reuse logic across multiple rules.

```typescript
// rules/coordination/shared-utils.ts
import { rule } from '../../utils.js';
import type { Request } from 'express';

// Shared helper
function extractUserId(req: Request): number | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  // Mock: extract user ID from token
  const token = authHeader.replace('Bearer ', '');
  const match = token.match(/user-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export const UserProfile = rule({
  methods: ['GET'],
  path: '/api/profile',
  handler: (req, res) => {
    const userId = extractUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    res.json({
      id: userId,
      name: `User ${userId}`,
      email: `user${userId}@example.com`,
    });
  },
});

export const UserSettings = rule({
  methods: ['GET'],
  path: '/api/settings',
  handler: (req, res) => {
    const userId = extractUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    res.json({
      userId,
      theme: 'dark',
      notifications: true,
      language: 'en',
    });
  },
});
```

**Test:**

```bash
# Both endpoints use shared extractUserId()
curl http://localhost:4000/api/profile \
  -H "Authorization: Bearer user-42"

curl http://localhost:4000/api/settings \
  -H "Authorization: Bearer user-42"
```

---

### 27. Rule Composition with next()

**Scenario:** Chain rules using `next()`.

```typescript
// rules/coordination/chain.ts
import { rule } from '../../utils.js';

// First rule: adds metadata, then passes through
export const AddMetadata = rule({
  methods: ['GET'],
  path: '/api/chain',
  handler: (req, res, next) => {
    // Augment request with custom property (use (req as any) for simplicity)
    (req as any)._metadata = {
      timestamp: Date.now(),
      source: 'override-proxy',
    };

    // Continue to next middleware
    next();
  },
});

// Second rule: uses metadata from first rule
export const UseMetadata = rule({
  methods: ['GET'],
  path: '/api/chain',
  handler: (req, res) => {
    const metadata = (req as any)._metadata || {};

    res.json({
      message: 'Rule chain example',
      metadata,
      data: 'Final response',
    });
  },
});
```

**Test:**

```bash
curl http://localhost:4000/api/chain
```

**Expected Output:**

```json
{
  "message": "Rule chain example",
  "metadata": {
    "timestamp": 1704067200000,
    "source": "override-proxy"
  },
  "data": "Final response"
}
```

**Note:** First matching rule that doesn't call `next()` wins. In this case, `AddMetadata` calls `next()`, so `UseMetadata` handles the response.

---

## Testing Your Rules

### Quick Test Script

Save as `test-rules.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:4000"

echo "Testing override-proxy rules..."
echo ""

echo "1. Basic hello:"
curl -s "$BASE_URL/__demo/hello" | jq .
echo ""

echo "2. User detail (ID 42):"
curl -s "$BASE_URL/api/users/42" | jq .
echo ""

echo "3. Auth with valid token:"
curl -s "$BASE_URL/api/auth/me" \
  -H "Authorization: Bearer valid-token-123" | jq .
echo ""

echo "4. Simulate 404 error:"
curl -s "$BASE_URL/api/test/404"
echo ""

echo "5. Slow endpoint (2s delay):"
time curl -s "$BASE_URL/api/slow" | jq .
echo ""

echo "All tests complete!"
```

Run with:

```bash
chmod +x test-rules.sh
./test-rules.sh
```

---

## Tips & Tricks

### 1. Debugging Rules

Add console.log to see when rules match:

```typescript
export const Debug = rule({
  path: '/api/data',
  handler: (req, res) => {
    console.log('Rule matched!', { path: req.path, query: req.query });
    res.json({ ok: true });
  },
});
```

### 2. Conditional Logging

```typescript
const DEBUG = process.env['DEBUG'] === '1';

export const Verbose = rule({
  path: '/api/verbose',
  handler: (req, res) => {
    if (DEBUG) {
      console.log('Headers:', req.headers);
      console.log('Query:', req.query);
    }
    res.json({ ok: true });
  },
});
```

### 3. Request Body Access

Add `express.json()` middleware in main.ts if not already present:

```typescript
// In main.ts, after line 165
app.use(express.json());
```

Then access in rules:

```typescript
export const HandlePost = rule('POST', '/api/data', (req, res) => {
  const body = req.body; // Parsed JSON
  res.json({ received: body });
});
```

### 4. Custom Headers

```typescript
export const CustomHeaders = rule('GET', '/api/custom', (_req, res) => {
  res.setHeader('X-Custom-Header', 'value');
  res.setHeader('X-Response-Time', Date.now().toString());
  res.json({ message: 'With custom headers' });
});
```

