# Development Tools

Automation tools and utilities for working with override-proxy.

## Claude Code Commands

Interactive AI-powered tools for rule development. Use these via `/command` in Claude Code.

### `/rule` - Create New Rule

Interactive assistant for creating new rules with templates.

**Usage:**
```
/rule              # Interactive mode with scenario selection
/rule auth         # Quick create with auth scenario
/rule error        # Quick create with error scenario
```

**Features:**
- Choose from 8 common scenarios (auth, error, latency, etc.)
- 27+ templates from docs/EXAMPLES.md
- Smart naming and file placement
- Generates test commands
- Applies best practices from docs/PATTERNS.md

**Scenarios:**
- `basic` - Simple path match
- `auth` - Authentication/authorization
- `error` - Error simulation
- `latency` - Latency injection
- `transform` - Data transformation
- `conditional` - Conditional proxying
- `stateful` - Stateful mocks
- `advanced` - GraphQL, pagination, etc.

---

### `/rule-toggle` - Manage Rule State

Enable, disable, or archive rule groups by renaming folders.

**Usage:**
```
/rule-toggle                   # Interactive mode
/rule-toggle disable auth      # Disable auth rules
/rule-toggle enable auth       # Enable auth rules
/rule-toggle archive old       # Archive to .trash/
```

**Actions:**
- **Disable** - Rename `rules/name/` → `rules/.name/`
- **Enable** - Rename `rules/.name/` → `rules/name/`
- **Archive** - Move `rules/name/` → `rules/.trash/name/`

**Reminder:** Changes require server restart (`pnpm dev`)

---

### `/rule-diagnose` - Debug Rules

Systematic diagnostic tool for troubleshooting non-working rules.

**Usage:**
```
/rule-diagnose                  # Interactive mode
/rule-diagnose UserDetail       # Diagnose specific rule
/rule-diagnose /api/users/123   # Diagnose by path
```

**Checks:**
1. File location (not in dot folder)
2. Export pattern (valid export)
3. Startup logs (rule loaded)
4. Test function (returns boolean)
5. Method matching
6. Path/regex matching
7. Async/await usage

**Output:**
- Issues found with specific fixes
- Working aspects
- Test commands
- Code examples

Based on docs/PATTERNS.md "Common Pitfalls" checklist.

---

### `/rule-test` - Test Rules

Generate and execute test commands for rules.

**Usage:**
```
/rule-test                  # Interactive mode
/rule-test UserDetail       # Test specific rule
/rule-test --all            # Test all rules
/rule-test --scenario auth  # Test all auth rules
```

**Features:**
- Analyzes rule code to extract test parameters
- Generates curl commands (success + error cases)
- Executes tests if server running
- Creates test scripts (bash or vitest)
- Validates responses

**Options:**
- `--save` - Save test scripts without running
- `--format <type>` - Output format: `bash`, `vitest`, `curl`
- `--verbose` - Show full request/response

---

### `/migrate-from-msw` - Convert MSW Handlers

Convert Mock Service Worker (MSW) handlers to override-proxy rules.

**Usage:**
```
/migrate-from-msw                       # Interactive mode
/migrate-from-msw src/mocks/handlers.ts # Convert specific file
/migrate-from-msw --all                 # Find and convert all
```

**Converts:**
- `rest.get/post()` → `rule()`
- `req.params` → regex captures
- `ctx.status()` → `res.status()`
- `ctx.json()` → `res.json()`
- `ctx.delay()` → async/await

**Output:**
- Converted rule files
- Migration report (success, failures, manual review needed)
- Migration checklist
- Test commands

Based on docs/PATTERNS.md "Migration Patterns".

---

## Bash Scripts

Standalone scripts in `scripts/` directory. No Claude Code required.

### `toggle-rules.sh` - Quick Toggle

Manage rule groups from command line.

**Usage:**
```bash
./scripts/toggle-rules.sh list              # List all groups
./scripts/toggle-rules.sh disable auth      # Disable auth group
./scripts/toggle-rules.sh enable auth       # Enable auth group
./scripts/toggle-rules.sh archive old       # Archive to .trash/
./scripts/toggle-rules.sh restore old       # Restore from .trash/
```

**Features:**
- Color-coded output (active, disabled, archived)
- Safety checks (no overwrites)
- Git awareness warnings
- Clear success/error messages

**Equivalent to:** `/rule-toggle` command

---

### `test-rules.sh` - Automated Testing

Test all rules with predefined test cases.

**Usage:**
```bash
./scripts/test-rules.sh           # Test all
./scripts/test-rules.sh builtin   # Test built-in endpoints
./scripts/test-rules.sh demo      # Test demo rules
./scripts/test-rules.sh auth      # Test auth rules
./scripts/test-rules.sh errors    # Test error rules
./scripts/test-rules.sh proxy     # Test proxy fallback
```

**Tests:**
- Built-in endpoints (`/__env`)
- Demo rules (`/__demo/hello`)
- Common auth endpoints (with/without tokens)
- Error simulation endpoints (4xx, 5xx)
- Proxy fallback (unmocked endpoints)

**Output:**
- Pass/fail status with colors
- Response details for failures
- Summary statistics

**Requirements:** Server must be running at `http://localhost:4000`

---

### `list-rules.sh` - Rule Inspector

List all rules with details.

**Usage:**
```bash
./scripts/list-rules.sh           # List active rules
./scripts/list-rules.sh --all     # Include disabled
./scripts/list-rules.sh --tree    # Tree structure
./scripts/list-rules.sh --stats   # Statistics
./scripts/list-rules.sh auth      # List specific group
```

**Shows:**
- Rule name (from export)
- HTTP methods
- Path pattern
- Enabled status
- File location

**Formats:**
- List view (default)
- Tree view (requires `tree` command)
- Statistics (counts by status)

---

## Tool Comparison

| Task | Claude Code Command | Bash Script | When to Use |
|------|------------------|-------------|-------------|
| Create rule | `/rule` | - | Always (interactive, templates) |
| Toggle group | `/rule-toggle` | `toggle-rules.sh` | Bash for quick CLI |
| Debug rule | `/rule-diagnose` | - | Always (intelligent analysis) |
| Test rules | `/rule-test` | `test-rules.sh` | Bash for CI/CD |
| List rules | - | `list-rules.sh` | Quick inspection |
| Migrate MSW | `/migrate-from-msw` | - | One-time conversion |

**Rule of thumb:**
- **Interactive/smart** → Use Claude Code command
- **Quick/scriptable** → Use bash scripts
- **CI/CD pipeline** → Use bash scripts

---

## Quick Reference

### Most Common Workflows

**Create a new rule:**
```
1. /rule
2. Select scenario
3. Provide details
4. Restart server: pnpm dev
5. Test with generated curl command
```

**Temporarily disable rules:**
```bash
./scripts/toggle-rules.sh disable experimental
pnpm dev
```

**Debug non-working rule:**
```
/rule-diagnose MyRule
# Follow the fix recommendations
pnpm dev
```

**Run all tests:**
```bash
pnpm dev  # In another terminal
./scripts/test-rules.sh
```

**List what's active:**
```bash
./scripts/list-rules.sh
```

---

## Installation

### Claude Code Commands

Commands are already installed in `.claude/commands/`. They're available automatically in Claude Code.

To verify:
```bash
ls .claude/commands/
# Should show: rule.md, rule-toggle.md, rule-diagnose.md, etc.
```

### Bash Scripts

Scripts are already in `scripts/` and executable. To verify:
```bash
ls -la scripts/
# Should show: -rwxr-xr-x for *.sh files
```

If not executable:
```bash
chmod +x scripts/*.sh
```

---

## Troubleshooting

### "Command not found"

**Cause:** Claude Code not recognizing command.

**Fix:**
1. Verify files exist: `ls .claude/commands/`
2. Restart Claude Code
3. Check file names match: `rule.md` not `rule-create.md`

### "Command not found" for bash scripts

**Cause:** Script not executable or wrong path.

**Fix:**
```bash
# Make executable
chmod +x scripts/*.sh

# Run from repo root
./scripts/test-rules.sh  # ✅ Correct
cd scripts && ./test-rules.sh  # ❌ Wrong (relative paths break)
```

### Commands timeout or hang

**Cause:** Large codebase or many files.

**Fix:**
- Use more specific commands (e.g., `/rule-diagnose RuleName` not `/rule-diagnose`)
- Test bash scripts first to verify rules work
- Check server is running for test-related command

---

## Extending Tools

### Add New Command

1. Create `.claude/commands/your-command.md`
2. Follow format of existing commands
3. Test with `/your-command`

See [Claude Code docs](https://docs.anthropic.com/claude-code) for command syntax.

### Add New Script

1. Create `scripts/your-script.sh`
2. Make executable: `chmod +x scripts/your-script.sh`
3. Follow bash script conventions (colors, error handling)
4. Add to this doc

---

## Further Reading

- **docs/EXAMPLES.md** - Templates used by `/rule`
- **docs/PATTERNS.md** - Best practices applied by tools
- **docs/ARCHITECTURE.md** - Code locations for tool development
- **AGENTS.md** - AI agent guidelines

---

**Last updated:** 2025-01 — Crescendo Lab
