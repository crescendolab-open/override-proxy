import type { Express } from "express";
import getPort from "get-port";
import type { Server as HttpServer } from "node:http";
import type { NormalizedConfig, NormalizedServer } from "./config.js";
import { createRoutedHttpApp, type HttpRouteRuntime } from "./http-app.js";
import { loadRuleRegistryFromDirs } from "./rule-loader.js";
import { sortRoutes } from "./route-matching.js";
import type { OverrideRule } from "./utils.js";
import { createWebSocketUpgradeHandler } from "./ws-direct-proxy.js";

export interface LegacyEnvSnapshot {
  target: string;
  port: number;
  corsOrigins?: string | undefined;
}

export interface StartConfiguredServersOptions {
  ensureRulesDirs?: readonly string[];
  legacyEnv?: LegacyEnvSnapshot;
}

export interface StartedServer {
  config: NormalizedServer;
  app: Express;
  listener: HttpServer;
  actualPort: number;
  routes: HttpRouteRuntime[];
}

export interface StartedRuntime {
  servers: StartedServer[];
  overrides: OverrideRule[];
}

export async function startConfiguredServers(
  config: NormalizedConfig,
  options: StartConfiguredServersOptions = {},
): Promise<StartedRuntime> {
  const startedServers: StartedServer[] = [];
  const allOverrides: OverrideRule[] = [];

  for (const serverConfig of config.servers) {
    const routes = await createRouteRuntimes(
      serverConfig,
      options.ensureRulesDirs ?? [],
    );
    for (const route of routes) allOverrides.push(...route.overrides);

    const { app } = createRoutedHttpApp({
      server: serverConfig,
      routes,
      ...(options.legacyEnv ? { legacyEnv: options.legacyEnv } : {}),
    });
    const actualPort = await selectPort(serverConfig);
    const listener = await listen(app, serverConfig, actualPort);
    listener.on("upgrade", createWebSocketUpgradeHandler({ routes }));

    logServerStartup(serverConfig, actualPort, routes);

    startedServers.push({
      config: serverConfig,
      app,
      listener,
      actualPort,
      routes,
    });
  }

  return {
    servers: startedServers,
    overrides: allOverrides,
  };
}

async function createRouteRuntimes(
  serverConfig: NormalizedServer,
  ensureRulesDirs: readonly string[],
): Promise<HttpRouteRuntime[]> {
  const routes: HttpRouteRuntime[] = [];

  for (const { route } of sortRoutes(serverConfig.routes)) {
    const httpRegistry =
      route.http === false
        ? await loadRuleRegistryFromDirs({ rulesDirs: [] })
        : await loadRuleRegistryFromDirs({
            rulesDirs: route.http.rulesDirs,
            ensureDirs: ensureRulesDirs,
          });
    const wsRegistry =
      route.ws === false
        ? await loadRuleRegistryFromDirs({ rulesDirs: [] })
        : await loadRuleRegistryFromDirs({
            rulesDirs: route.ws.rulesDirs,
          });

    routes.push({
      serverName: serverConfig.name,
      route,
      overrides: httpRegistry.overrides,
      metaMap: httpRegistry.metaMap,
      wsRules: wsRegistry.wsRules,
      wsMetaMap: wsRegistry.wsMetaMap,
      wsConnectionRules: wsRegistry.wsConnectionRules,
      wsConnectionMetaMap: wsRegistry.wsConnectionMetaMap,
    });
  }

  return routes;
}

async function selectPort(serverConfig: NormalizedServer): Promise<number> {
  const preferred = serverConfig.preferredPort;
  const candidates: number[] = [];
  for (let port = preferred; port < preferred + 10; port++)
    candidates.push(port);

  const listenHost =
    serverConfig.host === "0.0.0.0" ? undefined : serverConfig.host;
  const port = await getPort({
    port: candidates,
    ...(listenHost ? { host: listenHost } : {}),
  });
  if (port !== preferred) {
    console.log(`Port ${preferred} busy -> selected ${port}`);
  }
  return port;
}

async function listen(
  app: Express,
  serverConfig: NormalizedServer,
  port: number,
): Promise<HttpServer> {
  const listenHost =
    serverConfig.host === "0.0.0.0" ? undefined : serverConfig.host;

  return new Promise((resolve) => {
    let listener: HttpServer;
    if (listenHost) {
      listener = app.listen(port, listenHost, () => resolve(listener));
    } else {
      listener = app.listen(port, () => resolve(listener));
    }
  });
}

function logServerStartup(
  serverConfig: NormalizedServer,
  actualPort: number,
  routes: HttpRouteRuntime[],
): void {
  const displayHost =
    serverConfig.host === "0.0.0.0" ? "localhost" : serverConfig.host;

  console.log(
    `Server ${serverConfig.name} listening http://${displayHost}:${actualPort}`,
  );
  console.log(
    `Routes:\n${routes
      .map(({ route, overrides, wsConnectionRules, wsRules }) => {
        const target = route.target ?? "<none>";
        const wsRuleCount =
          route.ws === false
            ? ""
            : `, ${wsRules.length} WS rules, ${wsConnectionRules.length} WS connection rules`;
        return `  - ${route.path} -> ${target} (${overrides.length} HTTP rules${wsRuleCount})`;
      })
      .join("\n")}`,
  );
}
