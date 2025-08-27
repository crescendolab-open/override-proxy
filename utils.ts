import type { Method, MethodList, RuleHandler, RuleTest } from "./types.js";

export interface OverrideRule {
  name?: string; // identifier (for logs). Will be overridden by export name if present.
  enabled?: boolean; // default true
  methods: MethodList; // non-empty
  test: RuleTest;
  handler: RuleHandler;
}

// Internal metadata kept separately (not attached directly to the rule object)
export interface OverrideRuleMeta {
  file: string; // relative file path of rule provider
  export?: string | undefined; // export key (undefined for legacy/default)
  id: string; // synthesized id: <relPath>[:export]
}

// Config form accepted by rule(): rule({ path?, test?, methods?, ... }).
// - methods default: ["GET"]. Provide path or test.
export interface RuleConfig {
  name?: string;
  enabled?: boolean;
  methods?: Method[]; // defaults to ['GET']
  path?: string | RegExp;
  test?: RuleTest;
  handler: RuleHandler;
}

export function rule(
  method: Method | Method[],
  path: string | RegExp,
  handler: RuleHandler,
  options?: { enabled?: boolean }, // name removed: export name now authoritative
): OverrideRule;
export function rule(config: RuleConfig): OverrideRule;
export function rule(
  a: Method | Method[] | RuleConfig,
  b?: string | RegExp,
  c?: OverrideRule["handler"],
  d?: { name?: string; enabled?: boolean },
): OverrideRule {
  // Object config form
  if (
    typeof a === "object" &&
    !Array.isArray(a) &&
    typeof (a as any).handler === "function" &&
    b === undefined
  ) {
    const cfg = a as RuleConfig;
    const enabled = cfg.enabled !== false;
    const methods = (
      (cfg.methods && cfg.methods.length ? cfg.methods : ["GET"]) as Method[]
    ).map((m) => m.toUpperCase() as Method) as MethodList;
    const hasPath = cfg.path != null;
    if (!hasPath && typeof cfg.test !== "function") {
      throw new Error("rule(config) requires either path or test");
    }
    const isString = typeof cfg.path === "string";
    const regex = !isString && cfg.path instanceof RegExp ? cfg.path : null;
    const toMethod = (m: string): Method => m.toUpperCase() as Method;
    const testFn: RuleTest = cfg.test
      ? (req) =>
          enabled && methods.includes(toMethod(req.method)) && cfg.test!(req)
      : (req) => {
          if (!enabled) return false;
          if (!methods.includes(toMethod(req.method))) return false;
          if (isString) return req.path === cfg.path;
          return regex!.test(req.path);
        };
    const name =
      cfg.name ||
      (hasPath
        ? isString
          ? (cfg.path as string)
          : String(cfg.path)
        : undefined);
    return {
      ...(name ? { name } : {}),
      enabled,
      methods,
      test: testFn,
      handler: cfg.handler,
    } as OverrideRule;
  }
  // Signature form: rule(method, path, handler, options?)
  const method = a as Method | Method[];
  const path = b as string | RegExp;
  const handler = c as OverrideRule["handler"];
  const options = d as { enabled?: boolean } | undefined;
  const methods = (Array.isArray(method) ? method : [method]).map(
    (m) => m.toUpperCase() as Method,
  ) as MethodList;
  const enabled = options?.enabled !== false;
  const isString = typeof path === "string";
  const regex = isString ? null : (path as RegExp);
  return {
    name: isString ? (path as string) : path.toString(),
    enabled,
    methods,
    test: (req) => {
      const m = (req.method || "").toUpperCase() as Method;
      if (!enabled) return false;
      if (!methods.includes(m)) return false;
      return isString ? req.path === path : regex!.test(req.path);
    },
    handler,
  };
}

// Legacy export normalization kept for backward compatibility (not used by loader anymore)
export type RulesModule =
  | { default?: OverrideRule | OverrideRule[]; rules?: OverrideRule[] }
  | OverrideRule
  | OverrideRule[];

export function normalizeModule(m: RulesModule): OverrideRule[] {
  if (Array.isArray(m)) return m;
  if ((m as any)?.rules) return (m as any).rules;
  if ((m as any)?.default) {
    const d = (m as any).default;
    return Array.isArray(d) ? d : [d];
  }
  return [m as OverrideRule];
}

export function isOverrideRule(obj: any): obj is OverrideRule {
  return (
    !!obj &&
    typeof obj === "object" &&
    typeof obj.test === "function" &&
    typeof obj.handler === "function" &&
    Array.isArray(obj.methods)
  );
}
