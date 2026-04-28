import type { Method, MethodList, RuleHandler, RuleTest } from "./types.js";
import type { IncomingHttpHeaders } from "node:http";
import { resolve } from "pathe";

export interface OverrideRule {
  name?: string;
  enabled?: boolean;
  methods: MethodList;
  test: RuleTest;
  handler: RuleHandler;
}

export interface OverrideRuleMeta {
  file: string;
  export?: string | undefined;
  id: string;
}

export type WsMessageDirection = "client" | "upstream";

export interface WsMessageContext {
  serverName: string;
  routeName: string;
  connectionId: string;
  direction: WsMessageDirection;
  path: string;
  headers: IncomingHttpHeaders;
  raw: Buffer;
  text: string | null;
  json: unknown | null;
  jsonObject: Record<string, unknown> | null;
  forward(payload?: string | Buffer | object): WsRuleAction;
  skip(): WsRuleAction;
  emitToClient(payload: string | Buffer | object): void;
  emitToUpstream(payload: string | Buffer | object): void;
  close(code?: number, reason?: string): WsRuleAction;
  fail(error: string): WsRuleAction;
}

export type WsRuleAction =
  | { type: "forward"; payload?: string | Buffer | object }
  | { type: "skip" }
  | { type: "emitToClient"; payload: string | Buffer | object }
  | { type: "emitToUpstream"; payload: string | Buffer | object }
  | { type: "close"; code?: number; reason?: string }
  | { type: "fail"; error: string };

export interface WebSocketRule {
  name?: string;
  enabled?: boolean;
  test(ctx: WsMessageContext): boolean | Promise<boolean>;
  handler(ctx: WsMessageContext): WsRuleAction | Promise<WsRuleAction>;
}

export interface WsRuleConfig {
  name?: string;
  enabled?: boolean;
  test?: (ctx: WsMessageContext) => boolean | Promise<boolean>;
  handler(ctx: WsMessageContext): WsRuleAction | Promise<WsRuleAction>;
}

export interface RuleConfig {
  name?: string;
  enabled?: boolean;
  methods?: readonly Method[];
  path?: string | RegExp;
  test?: RuleTest;
  handler: RuleHandler;
}

export function rule(
  method: Method | readonly Method[],
  path: string | RegExp,
  handler: RuleHandler,
  options?: { enabled?: boolean },
): OverrideRule;
export function rule(config: RuleConfig): OverrideRule;
export function rule(
  a: Method | readonly Method[] | RuleConfig,
  b?: string | RegExp,
  c?: RuleHandler,
  d?: { enabled?: boolean },
): OverrideRule {
  if (isRuleConfig(a) && b === undefined) {
    return createRuleFromConfig(a);
  }

  if (typeof a !== "string" && !Array.isArray(a)) {
    throw new Error("rule(method, path, handler) requires a method");
  }
  if (typeof b !== "string" && !(b instanceof RegExp)) {
    throw new Error("rule(method, path, handler) requires a path");
  }
  if (typeof c !== "function") {
    throw new Error("rule(method, path, handler) requires a handler");
  }

  return createRuleFromPath(a, b, c, d);
}

function createRuleFromConfig(config: RuleConfig): OverrideRule {
  const enabled = config.enabled !== false;
  const methods = normalizeConfigMethods(config.methods);
  const pathTest =
    config.path === undefined ? null : createPathTest(config.path);
  const customTest = config.test;

  if (!pathTest && !customTest) {
    throw new Error("rule(config) requires either path or test");
  }

  const test: RuleTest = (req) => {
    if (!enabled || !methodListIncludes(methods, req.method)) return false;
    if (customTest) return customTest(req);
    return pathTest ? pathTest(req.path) : false;
  };
  const name = config.name ?? ruleNameFromPath(config.path);

  return {
    ...(name ? { name } : {}),
    enabled,
    methods,
    test,
    handler: config.handler,
  };
}

function createRuleFromPath(
  method: Method | readonly Method[],
  path: string | RegExp,
  handler: RuleHandler,
  options?: { enabled?: boolean },
): OverrideRule {
  const methods = normalizeMethodList(method);
  const enabled = options?.enabled !== false;
  const pathTest = createPathTest(path);

  return {
    name: String(path),
    enabled,
    methods,
    test: (req) => {
      if (!enabled || !methodListIncludes(methods, req.method)) return false;
      return pathTest(req.path);
    },
    handler,
  };
}

function createPathTest(path: string | RegExp): (pathname: string) => boolean {
  if (typeof path === "string") {
    return (pathname) => pathname === path;
  }
  return (pathname) => path.test(pathname);
}

function ruleNameFromPath(
  path: string | RegExp | undefined,
): string | undefined {
  return path === undefined ? undefined : String(path);
}

function normalizeConfigMethods(
  methods: readonly Method[] | undefined,
): MethodList {
  return methods && methods.length > 0 ? normalizeMethodList(methods) : ["GET"];
}

function normalizeMethodList(method: Method | readonly Method[]): MethodList {
  const methods = typeof method === "string" ? [method] : method;
  const [first, ...rest] = methods;
  if (!first) {
    throw new Error("rule() requires at least one method");
  }
  return [toMethod(first), ...rest.map(toMethod)];
}

function toMethod(method: string): Method {
  switch (method.toUpperCase()) {
    case "GET":
      return "GET";
    case "POST":
      return "POST";
    case "PUT":
      return "PUT";
    case "PATCH":
      return "PATCH";
    case "DELETE":
      return "DELETE";
    case "HEAD":
      return "HEAD";
    case "OPTIONS":
      return "OPTIONS";
    default:
      throw new Error(`Unsupported HTTP method: ${method}`);
  }
}

function toMethodOrNull(method: string | undefined): Method | null {
  if (!method) return null;
  try {
    return toMethod(method);
  } catch {
    return null;
  }
}

function methodListIncludes(
  methods: MethodList,
  method: string | undefined,
): boolean {
  const normalizedMethod = toMethodOrNull(method);
  return normalizedMethod ? methods.includes(normalizedMethod) : false;
}

export function wsRule(config: WsRuleConfig): WebSocketRule {
  const enabled = config.enabled !== false;
  return {
    ...(config.name ? { name: config.name } : {}),
    enabled,
    test: async (ctx) => enabled && (config.test ? config.test(ctx) : true),
    handler: config.handler,
  };
}

export type RulesModule =
  | { default?: OverrideRule | OverrideRule[]; rules?: OverrideRule[] }
  | OverrideRule
  | OverrideRule[];

export function normalizeModule(m: RulesModule): OverrideRule[] {
  if (Array.isArray(m)) return m.filter(isOverrideRule);
  if (isOverrideRule(m)) return [m];
  if (!isRecord(m)) return [];

  const rules = collectOverrideRules(m["rules"]);
  if (rules.length > 0) return rules;
  return collectOverrideRules(m["default"]);
}

export function isOverrideRule(obj: unknown): obj is OverrideRule {
  return (
    isRecord(obj) &&
    typeof obj["test"] === "function" &&
    typeof obj["handler"] === "function" &&
    isMethodList(obj["methods"])
  );
}

export function isWebSocketRule(obj: unknown): obj is WebSocketRule {
  return (
    isRecord(obj) &&
    typeof obj["test"] === "function" &&
    typeof obj["handler"] === "function" &&
    !Array.isArray(obj["methods"])
  );
}

export function parseRulesDir(argv: string[]): string | null {
  const inlineArg = argv.find((a) => a.startsWith("--rules-dir="));
  const inlineValue = inlineArg?.split("=").slice(1).join("=");
  if (inlineValue) return resolve(inlineValue);

  const argIndex = argv.indexOf("--rules-dir");
  if (argIndex < 0) return null;

  const value = argv[argIndex + 1];
  if (!value || value.startsWith("--")) return null;

  return resolve(value);
}

function isRuleConfig(value: unknown): value is RuleConfig {
  return isRecord(value) && typeof value["handler"] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMethodList(value: unknown): value is MethodList {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (method) => typeof method === "string" && toMethodOrNull(method),
    )
  );
}

function collectOverrideRules(value: unknown): OverrideRule[] {
  if (Array.isArray(value)) return value.filter(isOverrideRule);
  return isOverrideRule(value) ? [value] : [];
}
