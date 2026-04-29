# Toggle Rule Activation

Manage rule activation through config imports and `enabled` flags. The runtime
does not scan rule directories, and this command must not rename folders or rely
on dot-folder conventions.

## Invocation

- `/rule-toggle` - List active and inactive rules from the active config.
- `/rule-toggle disable <ruleName>` - Set one imported rule to `enabled: false`
  or remove it from the active config array.
- `/rule-toggle enable <ruleName>` - Re-add the rule to config or set
  `enabled: true`.

## Workflow

1. Locate the active config:
   - Prefer the explicit `--config` path when the user provides one.
   - Otherwise follow default discovery for `override-proxy.local.config.*`,
     `override-proxy.config.local.*`, then `override-proxy.config.*`.
2. Find the rule value imported by that config.
3. Choose the smallest config-driven change:
   - For a single rule: set `enabled: false`.
   - For a scenario pack: remove or branch the imported array in the config
     factory.
   - For local scratch work: use an ignored local config file.
4. Run `pnpm exec tsx cli.ts validate --config <path>` in this source checkout,
   or `pnpm exec override-proxy validate --config <path>` in a consuming app.
5. Report the exact config line changed and the validation result.

## Guardrails

- Do not add directory scanning, registry scripts, or folder rename workflows.
- Do not move rules into `.trash` or dot-prefixed folders to control runtime
  behavior.
- Keep rule modules importable and free of secrets.
