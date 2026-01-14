# Diagnose Rule Issues

Systematically debug why a rule isn't working using the troubleshooting checklist from docs/PATTERNS.md.

## Invocation

Users can invoke this command by:
- `/rule-diagnose` - Interactive mode (select rule from list)
- `/rule-diagnose <ruleName>` - Diagnose specific rule
- `/rule-diagnose <path>` - Diagnose by request path (e.g., `/rule-diagnose /api/users/123`)

## Behavior

When invoked, this command runs a systematic diagnostic:

### Phase 1: Rule Discovery
1. **Find the rule** - Search for rule by name or path pattern
2. **Check file location** - Verify it's in `rules/` and not ignored
3. **Verify export** - Confirm valid export pattern

### Phase 2: Startup Checks
4. **Check startup logs** - Parse server logs to see if rule was loaded
5. **Import errors** - Look for exceptions during rule import
6. **Name conflicts** - Check for duplicate rule names

### Phase 3: Runtime Checks
7. **Test function** - Verify `test()` returns boolean (not undefined)
8. **Method matching** - Check if `methods` array includes request method
9. **Path matching** - Test path/regex against sample URLs
10. **Enabled status** - Verify `enabled !== false`

### Phase 4: Request Testing
11. **Generate test command** - Create curl command to test the rule
12. **Execute test** (if server running) - Actually send request
13. **Analyze response** - Check if rule matched (from logs)

### Phase 5: Report & Fix

Generate a diagnostic report with:
- ✅ What's working correctly
- ❌ Issues found
- 🔧 Specific fix recommendations
- 📋 Test commands to verify fixes

## Diagnostic Checklist

Based on docs/PATTERNS.md "Checklist: Rule Not Working?"

### 1. File Location Check
```typescript
// Check if file is in rules/ and not ignored
const issues = [];

// Not in rules/ directory
if (!filePath.startsWith('rules/')) {
  issues.push({
    problem: 'File not in rules/ directory',
    location: filePath,
    fix: 'Move file to rules/ or a subfolder'
  });
}

// Dotfile or in dot folder
if (filePath.includes('/.') || filePath.startsWith('.')) {
  issues.push({
    problem: 'File or folder starts with dot (ignored by loader)',
    location: filePath,
    fix: 'Rename to remove leading dot'
  });
}

// In .trash/
if (filePath.includes('.trash/')) {
  issues.push({
    problem: 'File is archived in .trash/',
    location: filePath,
    fix: 'Move out of .trash/ to activate'
  });
}
```

### 2. Export Pattern Check
```typescript
// Check export patterns
const fileContent = await readFile(filePath);

const hasNamedExport = /export const \w+ = rule\(/.test(fileContent);
const hasDefaultExport = /export default rule\(/.test(fileContent);
const hasRulesArray = /export const rules = \[/.test(fileContent);

if (!hasNamedExport && !hasDefaultExport && !hasRulesArray) {
  issues.push({
    problem: 'No valid export pattern found',
    fix: 'Use: export const RuleName = rule(...)'
  });
}
```

### 3. Test Function Check
```typescript
// Common pitfall: test() not returning boolean
const hasReturn = /test:\s*\([^)]*\)\s*=>\s*\{[^}]*return/.test(fileContent);
const isArrowReturn = /test:\s*\([^)]*\)\s*=>(?!\s*\{)/.test(fileContent);

if (!hasReturn && !isArrowReturn) {
  issues.push({
    problem: 'test() function may not return boolean',
    fix: 'Ensure test() explicitly returns true/false',
    example: 'test: (req) => req.path === "/api/data" // ✅'
  });
}
```

### 4. Method Matching Check
```typescript
// Extract methods from rule
const methodsMatch = fileContent.match(/methods:\s*\[([^\]]+)\]/);
const methods = methodsMatch ?
  methodsMatch[1].split(',').map(m => m.trim().replace(/['"]/g, '')) :
  ['GET']; // default

// Check if request method is included
const requestMethod = 'GET'; // from test
if (!methods.includes(requestMethod)) {
  issues.push({
    problem: `Rule methods ${JSON.stringify(methods)} don't include ${requestMethod}`,
    fix: `Add '${requestMethod}' to methods array`,
    example: `methods: ['${requestMethod}', ...${JSON.stringify(methods)}]`
  });
}
```

### 5. Path Matching Check
```typescript
// Extract path pattern
const pathMatch = fileContent.match(/path:\s*['"`]([^'"`]+)['"`]/) ||
                 fileContent.match(/path:\s*(\/.*?\/[gimuy]*)/);

if (pathMatch) {
  const pattern = pathMatch[1];
  const testPath = '/api/users/123'; // from user or generated

  // Test string match
  if (typeof pattern === 'string') {
    if (pattern !== testPath) {
      issues.push({
        problem: `Path "${pattern}" doesn't match "${testPath}"`,
        fix: 'Use RegExp for dynamic paths',
        example: 'path: /^\\/api\\/users\\/\\d+$/'
      });
    }
  }

  // Test regex match
  else {
    try {
      const regex = new RegExp(pattern);
      if (!regex.test(testPath)) {
        issues.push({
          problem: `RegExp ${pattern} doesn't match "${testPath}"`,
          fix: 'Check regex pattern',
          example: 'Test at: https://regex101.com/'
        });
      }
    } catch (e) {
      issues.push({
        problem: `Invalid RegExp: ${pattern}`,
        fix: 'Fix regex syntax error',
        error: e.message
      });
    }
  }
}
```

### 6. Async/Await Check
```typescript
// Check for common async mistakes
const hasTimeout = /setTimeout/.test(fileContent);
const hasAsync = /async\s+\(/.test(fileContent) ||
                /handler:\s*async/.test(fileContent);

if (hasTimeout && !hasAsync) {
  issues.push({
    problem: 'Using setTimeout without async/await',
    fix: 'Make handler async and await Promise',
    example: `
handler: async (req, res) => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  res.json({ done: true });
}`
  });
}
```

## Common Issues Reference

From docs/PATTERNS.md "Common Pitfalls":

| Symptom | Likely Cause | Check |
|---------|--------------|-------|
| Rule not listed in startup | Import error / wrong location | Phase 1, 2 |
| Rule listed but not matching | test() returns falsy | Phase 3 |
| 500 error | Handler threw exception | Check server logs |
| CORS error | Origin not in CORS_ORIGINS | Check .env.local |
| Port mismatch | Preferred port busy | Check startup log |

## Output Format

Generate markdown report:

```markdown
# Diagnostic Report: <RuleName>

## Summary
- Status: ❌ Not Working / ⚠️ Partially Working / ✅ Working
- File: rules/path/to/file.ts
- Export: UserDetail

## Issues Found

### 1. ❌ Path Pattern Doesn't Match
**Problem**: Path "/api/users/123" doesn't match rule path "/api/users/1"
**Fix**: Use RegExp for dynamic segments
**Example**:
```typescript
export const UserDetail = rule({
  path: /^\/api\/users\/\d+$/,  // ✅ Matches any numeric ID
  handler: ...
});
```

### 2. ⚠️ Missing Return in test()
**Problem**: test() function doesn't explicitly return boolean
**Current**:
```typescript
test: (req) => {
  console.log('Checking...');
  req.path === '/api/data';  // ❌ No return!
}
```
**Fix**:
```typescript
test: (req) => {
  console.log('Checking...');
  return req.path === '/api/data';  // ✅ Explicit return
}
```

## Working Correctly

✅ File location: rules/users/detail.ts
✅ Export pattern: Named export (recommended)
✅ Methods include GET
✅ Enabled: true

## Next Steps

1. Apply fixes above
2. Restart server: `pnpm dev`
3. Test with: `curl http://localhost:4000/api/users/123`
4. Check logs for: `[1] match UserDetail`

## Test Command

```bash
curl -v http://localhost:4000/api/users/123 \
  -H "Content-Type: application/json"
```

Expected: 200 OK with user data
Actual: (run command to see)
```

## Example Interaction

```
User: /rule-diagnose UserDetail
