# Create New Override Rule

Interactive assistant for creating new override rules with templates and best practices.

## Invocation

Users can invoke this command by:
- `/rule` - Interactive mode with scenario selection
- `/rule <scenario>` - Quick create with scenario (e.g., `/rule auth`, `/rule error`)

## Behavior

When invoked, this command:

1. **Scenario Selection** - Ask user to choose from common scenarios:
   - `basic` - Simple path match with static data
   - `auth` - Authentication/authorization (JWT, API key, RBAC)
   - `error` - Error simulation (4xx, 5xx, random failures)
   - `latency` - Latency injection (fixed, random, configured)
   - `transform` - Data transformation (filter, aggregate, add fields)
   - `conditional` - Conditional proxying (header-based, A/B test)
   - `stateful` - Stateful mocks (in-memory CRUD)
   - `advanced` - Advanced scenarios (GraphQL, pagination, file download)

2. **Template Selection** - Based on scenario, show specific templates from docs/EXAMPLES.md

3. **Gather Information** - Ask for:
   - Rule name (PascalCase, descriptive)
   - HTTP method(s) (GET, POST, PUT, PATCH, DELETE)
   - Path pattern (string or regex)
   - File location (suggest based on scenario)

4. **Generate Rule File** - Create the rule file with:
   - **CRITICAL: Correct import statement** - Calculate relative path from rule file to `utils.js` in project root
     - Example: `rules/auth/jwt.ts` → `import { rule } from '../../utils.js';`
     - Example: `rules/user-detail.ts` → `import { rule } from '../utils.js';`
     - NEVER use `main.js` - the `rule` helper is exported from `utils.js`
   - Export name matching rule name
   - Template code adapted to user's inputs
   - Inline comments explaining key parts

5. **Type Check** - After creating file, run `npx tsc --noEmit` to verify:
   - Import path is correct
   - No type errors in generated code

6. **Generate Test Command** - Create curl command to test the rule

7. **Post-Creation Steps** - Remind user to:
   - Check type check passed (already done in step 5)
   - Restart dev server (`pnpm dev`)
   - Check startup logs for rule name
   - Run test command

## Templates Reference

Use these templates from docs/EXAMPLES.md:

### Basic Templates
- Simple path match (Example 1)
- Multiple HTTP methods (Example 2)
- RegExp with capture groups (Example 3)
- Query parameter filtering (Example 4)

### Auth Templates
- JWT authentication (Example 5)
- API key validation (Example 6)
- Role-based access control (Example 7)

### Error Templates
- 4xx errors (Example 14)
- 5xx errors (Example 15)
- Random failure injection (Example 16)

### Latency Templates
- Fixed delay (Example 17)
- Random latency (Example 18)
- Configured per-endpoint (Example 19)

### Transform Templates
- Add fields to response (Example 8)
- Filter sensitive data (Example 9)
- Aggregate multiple endpoints (Example 10)

### Conditional Templates
- Header-based bypass (Example 11)
- A/B testing (Example 12)
- Feature flag override (Example 13)

### Stateful Templates
- In-memory CRUD (Example 20)

### Advanced Templates
- Pagination (Example 21)
- File download (Example 22)
- GraphQL mock (Example 23)

## Best Practices to Apply

From docs/PATTERNS.md:

1. **Naming**:
   - File: kebab-case (e.g., `user-detail.ts`)
   - Export: PascalCase (e.g., `UserDetail`)
   - Pattern: `{Resource}Detail`, `Create{Resource}`, `List{Resource}s`

2. **Organization**:
   - Group related rules in folders (e.g., `rules/auth/`)
   - Use `_helpers/` for shared utilities
   - Never hardcode secrets (use env vars)

3. **Code Quality**:
   - Use `async/await` for delays
   - Always return boolean from `test()`
   - Add try-catch for async handlers
   - Pre-compile RegExp outside handler

4. **Testing**:
   - Provide curl test command
   - Test with multiple scenarios (success, error, edge cases)

## Example Interaction

```
User: /rule
