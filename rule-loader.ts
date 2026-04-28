import fg from "fast-glob";
import fsExtra from "fs-extra";
import { basename, join } from "pathe";
import { isOverrideRule, isWebSocketRule } from "./utils.js";
import type { OverrideRule, OverrideRuleMeta, WebSocketRule } from "./utils.js";

export type LoadedRule = {
  rule: OverrideRule;
  relPath: string;
  exportName?: string | undefined;
};

export type LoadedWebSocketRule = {
  rule: WebSocketRule;
  relPath: string;
  exportName?: string | undefined;
};

export interface RuleRegistry {
  overrides: OverrideRule[];
  wsRules: WebSocketRule[];
  metaMap: WeakMap<OverrideRule, OverrideRuleMeta>;
  wsMetaMap: WeakMap<WebSocketRule, OverrideRuleMeta>;
}

export interface LoadRuleRegistryOptions {
  rulesDir: string;
  externalRulesDir?: string | null;
}

export interface LoadRuleRegistryFromDirsOptions {
  rulesDirs: readonly string[];
  ensureDirs?: readonly string[];
}

export async function loadRulesFromDir(dir: string): Promise<LoadedRule[]> {
  if (!(await fsExtra.pathExists(dir))) return [];
  const entries = await fg(["**/*.ts", "**/*.js"], {
    cwd: dir,
    dot: false,
    ignore: ["**/*.d.ts"],
  });
  const loaded: LoadedRule[] = [];
  for (const rel of entries) {
    const full = join(dir, rel);
    try {
      const mod = toModuleRecord(await import(full));
      for (const { rule, exportName } of collectOverrideRuleExports(mod)) {
        loaded.push({
          rule: withHttpExportName(rule, exportName),
          relPath: rel,
          exportName,
        });
      }
    } catch (e) {
      console.error("Failed loading rule module", join(basename(dir), rel), e);
    }
  }
  return loaded;
}

export async function loadWebSocketRulesFromDir(
  dir: string,
): Promise<LoadedWebSocketRule[]> {
  if (!(await fsExtra.pathExists(dir))) return [];
  const entries = await fg(["**/*.ts", "**/*.js"], {
    cwd: dir,
    dot: false,
    ignore: ["**/*.d.ts"],
  });
  const loaded: LoadedWebSocketRule[] = [];
  for (const rel of entries) {
    const full = join(dir, rel);
    try {
      const mod = toModuleRecord(await import(full));
      for (const { rule, exportName } of collectWebSocketRuleExports(mod)) {
        loaded.push({
          rule: withWebSocketExportName(rule, exportName),
          relPath: rel,
          exportName,
        });
      }
    } catch (e) {
      console.error("Failed loading rule module", join(basename(dir), rel), e);
    }
  }
  return loaded;
}

export function createRuleRegistry(): RuleRegistry {
  return {
    overrides: [],
    wsRules: [],
    metaMap: new WeakMap<OverrideRule, OverrideRuleMeta>(),
    wsMetaMap: new WeakMap<WebSocketRule, OverrideRuleMeta>(),
  };
}

export function registerRules(
  registry: RuleRegistry,
  loaded: LoadedRule[],
  dir: string,
): void {
  const dirName = basename(dir);
  for (const { rule, relPath, exportName } of loaded) {
    const file = `${dirName}/${relPath}`;
    const id = exportName ? `${file}:${exportName}` : file;
    registry.metaMap.set(rule, { file, export: exportName, id });
    registry.overrides.push(rule);
  }
}

export function registerWebSocketRules(
  registry: RuleRegistry,
  loaded: LoadedWebSocketRule[],
  dir: string,
): void {
  const dirName = basename(dir);
  for (const { rule, relPath, exportName } of loaded) {
    const file = `${dirName}/${relPath}`;
    const id = exportName ? `${file}:${exportName}` : file;
    registry.wsMetaMap.set(rule, { file, export: exportName, id });
    registry.wsRules.push(rule);
  }
}

export async function loadRuleRegistry({
  rulesDir,
  externalRulesDir,
}: LoadRuleRegistryOptions): Promise<RuleRegistry> {
  return loadRuleRegistryFromDirs({
    rulesDirs: [...(externalRulesDir ? [externalRulesDir] : []), rulesDir],
    ensureDirs: [rulesDir],
  });
}

export async function loadRuleRegistryFromDirs({
  rulesDirs,
  ensureDirs = [],
}: LoadRuleRegistryFromDirsOptions): Promise<RuleRegistry> {
  const registry = createRuleRegistry();
  const ensureDirSet = new Set(ensureDirs);

  for (const rulesDir of rulesDirs) {
    if (ensureDirSet.has(rulesDir)) {
      await fsExtra.ensureDir(rulesDir);
    }
    registerRules(registry, await loadRulesFromDir(rulesDir), rulesDir);
    registerWebSocketRules(
      registry,
      await loadWebSocketRulesFromDir(rulesDir),
      rulesDir,
    );
  }

  return registry;
}

type ModuleRecord = Record<string, unknown>;
type CollectedHttpRule = {
  rule: OverrideRule;
  exportName?: string | undefined;
};
type CollectedWebSocketRule = {
  rule: WebSocketRule;
  exportName?: string | undefined;
};

function collectOverrideRuleExports(mod: ModuleRecord): CollectedHttpRule[] {
  const collected: CollectedHttpRule[] = [];
  collectOverrideRules(collected, mod["default"]);
  collectOverrideRules(collected, mod["rules"]);

  for (const [key, value] of Object.entries(mod)) {
    if (key === "default" || key === "rules") continue;
    collectOverrideRules(collected, value, key);
  }

  return collected;
}

function collectWebSocketRuleExports(
  mod: ModuleRecord,
): CollectedWebSocketRule[] {
  const collected: CollectedWebSocketRule[] = [];
  collectWebSocketRules(collected, mod["default"]);
  collectWebSocketRules(collected, mod["rules"]);
  collectWebSocketRules(collected, mod["wsRules"]);

  for (const [key, value] of Object.entries(mod)) {
    if (key === "default" || key === "rules" || key === "wsRules") continue;
    collectWebSocketRules(collected, value, key);
  }

  return collected;
}

function collectOverrideRules(
  collected: CollectedHttpRule[],
  value: unknown,
  exportName?: string,
): void {
  if (isOverrideRule(value)) {
    collected.push({ rule: value, exportName });
    return;
  }
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (isOverrideRule(item)) collected.push({ rule: item, exportName });
  }
}

function collectWebSocketRules(
  collected: CollectedWebSocketRule[],
  value: unknown,
  exportName?: string,
): void {
  if (isWebSocketRule(value)) {
    collected.push({ rule: value, exportName });
    return;
  }
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (isWebSocketRule(item)) collected.push({ rule: item, exportName });
  }
}

function withHttpExportName(
  rule: OverrideRule,
  exportName?: string,
): OverrideRule {
  return exportName && !rule.name ? { ...rule, name: exportName } : rule;
}

function withWebSocketExportName(
  rule: WebSocketRule,
  exportName?: string,
): WebSocketRule {
  return exportName && !rule.name ? { ...rule, name: exportName } : rule;
}

function toModuleRecord(value: unknown): ModuleRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is ModuleRecord {
  return typeof value === "object" && value !== null;
}
