import fg from "fast-glob";
import fsExtra from "fs-extra";
import { basename, join } from "pathe";
import {
  isOverrideRule,
  isWebSocketConnectionRule,
  isWebSocketRule,
} from "./utils.js";
import type {
  OverrideRule,
  OverrideRuleMeta,
  WebSocketConnectionRule,
  WebSocketRule,
} from "./utils.js";

const RULE_FILE_PATTERNS = ["**/*.ts", "**/*.mts", "**/*.js", "**/*.mjs"];
const RULE_FILE_IGNORES = ["**/*.d.ts", "**/*.d.mts"];

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

export type LoadedWebSocketConnectionRule = {
  rule: WebSocketConnectionRule;
  relPath: string;
  exportName?: string | undefined;
};

type LoadedRuleEntry<T> = {
  rule: T;
  relPath: string;
  exportName?: string | undefined;
};

type CollectedRuleEntry<T> = {
  rule: T;
  exportName?: string | undefined;
};

export interface RuleRegistry {
  overrides: OverrideRule[];
  wsRules: WebSocketRule[];
  wsConnectionRules: WebSocketConnectionRule[];
  metaMap: WeakMap<OverrideRule, OverrideRuleMeta>;
  wsMetaMap: WeakMap<WebSocketRule, OverrideRuleMeta>;
  wsConnectionMetaMap: WeakMap<WebSocketConnectionRule, OverrideRuleMeta>;
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
  return loadRuleEntriesFromDir(
    dir,
    collectOverrideRuleExports,
    withHttpExportName,
  );
}

export async function loadWebSocketRulesFromDir(
  dir: string,
): Promise<LoadedWebSocketRule[]> {
  return loadRuleEntriesFromDir(
    dir,
    collectWebSocketRuleExports,
    withWebSocketExportName,
  );
}

export async function loadWebSocketConnectionRulesFromDir(
  dir: string,
): Promise<LoadedWebSocketConnectionRule[]> {
  return loadRuleEntriesFromDir(
    dir,
    collectWebSocketConnectionRuleExports,
    withWebSocketConnectionExportName,
  );
}

async function loadRuleEntriesFromDir<T>(
  dir: string,
  collect: (mod: ModuleRecord) => CollectedRuleEntry<T>[],
  withExportName: (rule: T, exportName?: string) => T,
): Promise<LoadedRuleEntry<T>[]> {
  if (!(await fsExtra.pathExists(dir))) return [];
  const entries = await fg(RULE_FILE_PATTERNS, {
    cwd: dir,
    dot: false,
    ignore: RULE_FILE_IGNORES,
  });
  const loaded: LoadedRuleEntry<T>[] = [];
  for (const rel of entries) {
    const full = join(dir, rel);
    try {
      const mod = toModuleRecord(await import(full));
      for (const { rule, exportName } of collect(mod)) {
        loaded.push({
          rule: withExportName(rule, exportName),
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
    wsConnectionRules: [],
    metaMap: new WeakMap<OverrideRule, OverrideRuleMeta>(),
    wsMetaMap: new WeakMap<WebSocketRule, OverrideRuleMeta>(),
    wsConnectionMetaMap: new WeakMap<
      WebSocketConnectionRule,
      OverrideRuleMeta
    >(),
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

export function registerWebSocketConnectionRules(
  registry: RuleRegistry,
  loaded: LoadedWebSocketConnectionRule[],
  dir: string,
): void {
  const dirName = basename(dir);
  for (const { rule, relPath, exportName } of loaded) {
    const file = `${dirName}/${relPath}`;
    const id = exportName ? `${file}:${exportName}` : file;
    registry.wsConnectionMetaMap.set(rule, { file, export: exportName, id });
    registry.wsConnectionRules.push(rule);
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
    registerWebSocketConnectionRules(
      registry,
      await loadWebSocketConnectionRulesFromDir(rulesDir),
      rulesDir,
    );
  }

  return registry;
}

type ModuleRecord = Record<string, unknown>;
type CollectedHttpRule = CollectedRuleEntry<OverrideRule>;
type CollectedWebSocketRule = CollectedRuleEntry<WebSocketRule>;
type CollectedWebSocketConnectionRule =
  CollectedRuleEntry<WebSocketConnectionRule>;

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

function collectWebSocketConnectionRuleExports(
  mod: ModuleRecord,
): CollectedWebSocketConnectionRule[] {
  const collected: CollectedWebSocketConnectionRule[] = [];
  collectWebSocketConnectionRules(collected, mod["default"]);
  collectWebSocketConnectionRules(collected, mod["rules"]);
  collectWebSocketConnectionRules(collected, mod["wsRules"]);
  collectWebSocketConnectionRules(collected, mod["wsConnectionRules"]);

  for (const [key, value] of Object.entries(mod)) {
    if (
      key === "default" ||
      key === "rules" ||
      key === "wsRules" ||
      key === "wsConnectionRules"
    ) {
      continue;
    }
    collectWebSocketConnectionRules(collected, value, key);
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

function collectWebSocketConnectionRules(
  collected: CollectedWebSocketConnectionRule[],
  value: unknown,
  exportName?: string,
): void {
  if (isWebSocketConnectionRule(value)) {
    collected.push({ rule: value, exportName });
    return;
  }
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (isWebSocketConnectionRule(item)) {
      collected.push({ rule: item, exportName });
    }
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

function withWebSocketConnectionExportName(
  rule: WebSocketConnectionRule,
  exportName?: string,
): WebSocketConnectionRule {
  return exportName && !rule.name ? { ...rule, name: exportName } : rule;
}

function toModuleRecord(value: unknown): ModuleRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is ModuleRecord {
  return typeof value === "object" && value !== null;
}
