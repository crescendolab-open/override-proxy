import dotenvx from "@dotenvx/dotenvx";
import fsExtra from "fs-extra";
import { resolve } from "pathe";
import type {
  OverrideRule,
  WebSocketConnectionRule,
  WebSocketRule,
} from "./utils.js";

export const DEFAULT_CONFIG_FILES = [
  "override-proxy.local.config.ts",
  "override-proxy.local.config.mts",
  "override-proxy.local.config.js",
  "override-proxy.local.config.mjs",
  "override-proxy.config.local.ts",
  "override-proxy.config.local.mts",
  "override-proxy.config.local.js",
  "override-proxy.config.local.mjs",
  "override-proxy.config.ts",
  "override-proxy.config.mts",
  "override-proxy.config.js",
  "override-proxy.config.mjs",
] as const;

export type NonEmptyArray<T> = readonly [T, ...T[]];
export type RoutePath = `/${string}`;

export type OverrideProxyConfigExport =
  | OverrideProxyConfig
  | OverrideProxyConfigFactory;

export type OverrideProxyConfigFactory = (
  ctx: OverrideProxyConfigContext,
) => OverrideProxyConfig | Promise<OverrideProxyConfig>;

export interface OverrideProxyConfigContext {
  cwd: string;
  configFile: string | null;
  env: Record<string, string | undefined>;
}

export interface OverrideProxyConfig {
  servers: NonEmptyArray<ServerConfig>;
}

export interface ServerConfig {
  name?: string;
  host?: string;
  port?: number;
  cors?: CorsConfig | false;
  control?: ControlConfig | false;
  routes: NonEmptyArray<RouteConfig>;
}

export interface CorsConfig {
  origins?: readonly string[] | true;
}

export interface ControlConfig {
  path?: RoutePath;
}

export interface RouteConfig {
  name?: string;
  path: RoutePath;
  priority?: number;
  target?: string | null;
  rules?: readonly OverrideRule[];
  rewrite?: RouteRewrite | null;
  http?: HttpTransportConfig | false;
  ws?: WsTransportConfig | false;
}

export interface RouteRewrite {
  stripPrefix?: boolean;
  prefix?: RoutePath;
  path?: (ctx: RouteRewriteContext) => string;
}

export interface RouteRewriteContext {
  pathname: string;
  route: RouteConfig;
}

export interface HttpTransportConfig {
  enabled?: boolean;
  rules?: readonly OverrideRule[];
}

export interface WsTransportConfig {
  enabled?: boolean;
  mode?: "direct" | "bridge" | "mock";
  target?: string | null;
  rules?: readonly WebSocketRule[];
  connectionRules?: readonly WebSocketConnectionRule[];
}

export interface NormalizedConfig {
  cwd: string;
  configFile: string | null;
  servers: NormalizedServer[];
}

export interface NormalizedServer {
  name: string;
  host: string;
  preferredPort: number;
  cors: NormalizedCors | false;
  control: NormalizedControl | false;
  routes: NormalizedRoute[];
}

export interface NormalizedCors {
  origins: string[] | true;
}

export interface NormalizedControl {
  path: RoutePath;
}

export interface NormalizedRoute {
  name: string;
  path: RoutePath;
  priority: number;
  target: string | null;
  rules: OverrideRule[];
  rewrite: RouteRewrite | null;
  http: NormalizedHttpTransport | false;
  ws: NormalizedWsTransport | false;
}

export interface NormalizedHttpTransport {
  enabled: true;
  rules: OverrideRule[];
}

export interface NormalizedWsTransport {
  enabled: true;
  mode: "direct" | "bridge" | "mock";
  target: string | null;
  rules: WebSocketRule[];
  connectionRules: WebSocketConnectionRule[];
}

export interface RuntimeConfig {
  TARGET: string;
  PORT: number;
  CORS_ORIGINS: string | undefined;
}

export interface NormalizeLegacyConfigOptions {
  cwd?: string;
  configFile?: string | null;
}

export interface NormalizeConfigOptions {
  cwd?: string;
  configFile?: string | null;
}

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

export class ConfigValidationError extends Error {
  issues: ConfigValidationIssue[];

  constructor(issues: ConfigValidationIssue[]) {
    super(
      `Invalid override-proxy config:\n${issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export function defineConfig<const T extends OverrideProxyConfigExport>(
  config: T,
): T {
  return config;
}

export async function discoverConfigFile(
  cwd: string = process.cwd(),
): Promise<string | null> {
  for (const fileName of DEFAULT_CONFIG_FILES) {
    const filePath = resolve(cwd, fileName);
    if (await fsExtra.pathExists(filePath)) return filePath;
  }
  return null;
}

export function parseConfigPath(
  argv: string[],
  cwd: string = process.cwd(),
): string | null {
  const inlineArg = argv.find((arg) => arg.startsWith("--config="));
  const inlineValue = inlineArg?.split("=").slice(1).join("=");
  if (inlineValue) return resolve(cwd, inlineValue);

  const argIndex = argv.indexOf("--config");
  if (argIndex < 0) return null;

  const value = argv[argIndex + 1];
  if (!value || value.startsWith("--")) return null;

  return resolve(cwd, value);
}

export function normalizeLegacyConfig(
  config: RuntimeConfig,
  options: NormalizeLegacyConfigOptions = {},
): NormalizedConfig {
  const corsOrigins = config.CORS_ORIGINS
    ? config.CORS_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : true;

  return {
    cwd: options.cwd ?? process.cwd(),
    configFile: options.configFile ?? null,
    servers: [
      {
        name: "main",
        host: "0.0.0.0",
        preferredPort: config.PORT,
        cors: {
          origins: corsOrigins,
        },
        control: {
          path: "/__env",
        },
        routes: [
          {
            name: "root",
            path: "/",
            priority: 0,
            target: config.TARGET,
            rules: [],
            rewrite: null,
            http: {
              enabled: true,
              rules: [],
            },
            ws: false,
          },
        ],
      },
    ],
  };
}

export function normalizeConfig(
  config: OverrideProxyConfig,
  options: NormalizeConfigOptions = {},
): NormalizedConfig {
  const cwd = options.cwd ?? process.cwd();
  const configFile = options.configFile ?? null;

  return {
    cwd,
    configFile,
    servers: config.servers.map((server, serverIndex) =>
      normalizeServerConfig(server, serverIndex),
    ),
  };
}

export function validateNormalizedConfig(
  config: NormalizedConfig,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  const serverNames = new Set<string>();

  config.servers.forEach((server, serverIndex) => {
    const serverPath = `servers[${serverIndex}]`;
    validateName(server.name, `${serverPath}.name`, issues);
    if (serverNames.has(server.name)) {
      issues.push({
        path: `${serverPath}.name`,
        message: `Duplicate server name "${server.name}"`,
      });
    }
    serverNames.add(server.name);

    if (server.control !== false) {
      validatePath(server.control.path, `${serverPath}.control.path`, issues);
      if (server.control.path === "/") {
        issues.push({
          path: `${serverPath}.control.path`,
          message: "Control path cannot be /",
        });
      }
    }

    validateRoutes(server.routes, serverPath, issues);
  });

  return issues;
}

export function assertValidNormalizedConfig(config: NormalizedConfig): void {
  const issues = validateNormalizedConfig(config);
  if (issues.length) throw new ConfigValidationError(issues);
}

function normalizeServerConfig(
  server: ServerConfig,
  serverIndex: number,
): NormalizedServer {
  return {
    name:
      server.name ?? (serverIndex === 0 ? "main" : `server-${serverIndex + 1}`),
    host: server.host ?? "0.0.0.0",
    preferredPort: server.port ?? 4000,
    cors: normalizeCorsConfig(server.cors),
    control:
      server.control === false
        ? false
        : {
            path: server.control?.path ?? "/__override",
          },
    routes: server.routes.map((route, routeIndex) =>
      normalizeRouteConfig(route, routeIndex),
    ),
  };
}

function normalizeCorsConfig(
  corsConfig: CorsConfig | false | undefined,
): NormalizedCors | false {
  if (corsConfig === false) return false;

  const origins = corsConfig?.origins;
  return {
    origins: origins == null || origins === true ? true : [...origins],
  };
}

function normalizeRouteConfig(
  route: RouteConfig,
  routeIndex: number,
): NormalizedRoute {
  const routeRules = [...(route.rules ?? [])];
  const httpRules =
    route.http === false
      ? []
      : [...routeRules, ...((route.http && route.http.rules) || [])];

  return {
    name: route.name ?? defaultRouteName(route.path, routeIndex),
    path: route.path,
    priority: route.priority ?? 0,
    target: route.target ?? null,
    rules: routeRules,
    rewrite: route.rewrite ?? null,
    http:
      route.http === false
        ? false
        : {
            enabled: true,
            rules: httpRules,
          },
    ws: normalizeWsConfig(route),
  };
}

function normalizeWsConfig(route: RouteConfig): NormalizedWsTransport | false {
  const ws = route.ws;
  if (!ws || ws.enabled === false) return false;

  return {
    enabled: true,
    mode: ws.mode ?? "direct",
    target: ws.target ?? route.target ?? null,
    rules: [...(ws.rules ?? [])],
    connectionRules: [...(ws.connectionRules ?? [])],
  };
}

function defaultRouteName(path: RoutePath, routeIndex: number): string {
  if (path === "/") return "root";

  const name = path
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return name || `route-${routeIndex + 1}`;
}

function validateRoutes(
  routes: NormalizedRoute[],
  serverPath: string,
  issues: ConfigValidationIssue[],
): void {
  const routeNames = new Set<string>();
  const routeTopology = new Set<string>();

  routes.forEach((route, routeIndex) => {
    const routePath = `${serverPath}.routes[${routeIndex}]`;
    validateName(route.name, `${routePath}.name`, issues);
    validatePath(route.path, `${routePath}.path`, issues);

    if (routeNames.has(route.name)) {
      issues.push({
        path: `${routePath}.name`,
        message: `Duplicate route name "${route.name}"`,
      });
    }
    routeNames.add(route.name);

    const topologyKey = `${route.path}#${route.priority}`;
    if (routeTopology.has(topologyKey)) {
      issues.push({
        path: `${routePath}.path`,
        message: `Duplicate route path "${route.path}" with priority ${route.priority}`,
      });
    }
    routeTopology.add(topologyKey);
  });
}

function validateName(
  name: string,
  path: string,
  issues: ConfigValidationIssue[],
): void {
  if (!name.trim()) {
    issues.push({
      path,
      message: "Name cannot be empty",
    });
  }
}

function validatePath(
  pathValue: string,
  path: string,
  issues: ConfigValidationIssue[],
): void {
  if (!pathValue.startsWith("/")) {
    issues.push({
      path,
      message: "Path must start with /",
    });
  }
  if (pathValue.includes("?") || pathValue.includes("#")) {
    issues.push({
      path,
      message: "Path must not include query strings or hashes",
    });
  }
}

export function loadEnvironment(): void {
  dotenvx.config({
    path: [".env.local", ".env.default"],
    quiet: true,
    ignore: ["MISSING_ENV_FILE"],
  });
}

export function resolveRuntimeConfig(
  _argv: string[] = process.argv,
  _moduleUrl: string = import.meta.url,
): RuntimeConfig {
  loadEnvironment();

  return {
    TARGET: process.env["PROXY_TARGET"] || "https://pokeapi.co/api/v2/",
    PORT: Number(process.env["PORT"] || 4000),
    CORS_ORIGINS: process.env["CORS_ORIGINS"],
  };
}
