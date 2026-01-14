# Toggle Rule Activation

Manage rule and rule group activation state by renaming folders/files.

## Invocation

Users can invoke this command by:
- `/rule-toggle` - Interactive mode listing all toggleable groups
- `/rule-toggle disable <name>` - Disable rule group
- `/rule-toggle enable <name>` - Enable rule group
- `/rule-toggle archive <name>` - Archive to .trash/

## Behavior

When invoked, this command:

1. **Scan Rules Directory** - List all:
   - Active folders (no dot prefix)
   - Disabled folders (dot prefix, not in .trash)
   - Archived folders (in .trash/)

2. **Show Current State** - Display organized list:
   ```
   Active Groups:
     - auth/ (3 rules)
     - commerce/ (5 rules)
     - demo/ (2 rules)

   Disabled Groups:
     - .experimental/ (4 rules)
     - .wip/ (1 rule)

   Archived Groups (.trash/):
     - legacy-2024/ (8 rules)
   ```

3. **Execute Action** based on command:

   **Disable**: Rename `rules/name/` → `rules/.name/`
   - Verify folder exists
   - Add dot prefix
   - Confirm success
   - Remind to restart server

   **Enable**: Rename `rules/.name/` → `rules/name/`
   - Verify disabled folder exists
   - Remove dot prefix
   - Confirm success
   - Remind to restart server

   **Archive**: Move `rules/name/` → `rules/.trash/name/`
   - Verify folder exists
   - Create .trash/ if needed
   - Move entire folder
   - Confirm success

4. **Post-Action** - Always remind:
   - Changes take effect after server restart
   - Run `pnpm dev` to reload
   - Check startup logs to verify

## Convention Reference

From docs/PATTERNS.md and docs/ARCHITECTURE.md:

### Folder Naming Conventions

| Status | Pattern | Example |
|--------|---------|---------|
| Active | `name/` | `rules/auth/` |
| Disabled | `.name/` | `rules/.auth/` |
| Archived | `.trash/name/` | `rules/.trash/auth/` |
| Personal/WIP | `.{initials}/` or `.wip/` | `rules/.john/`, `rules/.wip/` |

### Loader Behavior

The rule loader (fast-glob with `dot: false`) ignores:
- Files/folders starting with `.`
- Type definitions `*.d.ts`

**Code:** main.ts:38-42

## Safety Checks

Before any rename/move operation:

1. **Verify source exists**
   - For disable: Check `rules/name/` exists
   - For enable: Check `rules/.name/` exists
   - For archive: Check `rules/name/` exists

2. **Verify target doesn't exist**
   - For disable: Check `rules/.name/` doesn't exist
   - For enable: Check `rules/name/` doesn't exist
   - For archive: Check `rules/.trash/name/` doesn't exist

3. **Handle conflicts**
   - If target exists, ask user to choose:
     - Overwrite (merge)
     - Rename with suffix (e.g., `.name-2`)
     - Abort

4. **Git awareness**
   - Warn if folder has uncommitted changes
   - Suggest committing or stashing first

## Example Interactions

### Interactive Mode
```
User: /rule-toggle