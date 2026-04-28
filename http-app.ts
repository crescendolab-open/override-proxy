import express, { type Express, type Response } from "express";
import cors from "cors";
import type { RequestHandler } from "express";
import type { NormalizedRoute, NormalizedServer } from "./config.js";
import {
  logError,
  logRequestEnd,
  logRequestMatch,
  logRequestStart,
} from "./logger.js";
import { createProxyFallback } from "./proxy-fallback.js";
import { findRoute, rewriteRoutePath } from "./route-matching.js";
import type { OverrideRule, OverrideRuleMeta, WebSocketRule } from "./utils.js";

export interface CreateHttpAppOptions {
  target: string;
  port: number;
  corsOrigins?: string | undefined;
  overrides: OverrideRule[];
  metaMap: WeakMap<OverrideRule, OverrideRuleMeta>;
}

export interface CreatedHttpApp {
  app: Express;
  nextRequestId: () => number;
}

export interface HttpRouteRuntime {
  serverName: string;
  route: NormalizedRoute;
  overrides: OverrideRule[];
  metaMap: WeakMap<OverrideRule, OverrideRuleMeta>;
  wsRules: WebSocketRule[];
  wsMetaMap: WeakMap<WebSocketRule, OverrideRuleMeta>;
}

export interface CreateRoutedHttpAppOptions {
  server: NormalizedServer;
  routes: HttpRouteRuntime[];
  legacyEnv?: {
    target: string;
    port: number;
    corsOrigins?: string | undefined;
  };
}

interface ResponseLogState {
  id: number;
  start: number;
  via?: "override" | "proxy" | undefined;
  matched?: string | undefined;
}

interface ResponseLogStore {
  nextRequestId: () => number;
  middleware: RequestHandler;
  markOverride: (res: Response, match: string) => void;
  markProxy: (res: Response) => void;
  resolveLogId: (res: Response) => number;
}

export function createHttpApp({
  target,
  port,
  corsOrigins,
  overrides,
  metaMap,
}: CreateHttpAppOptions): CreatedHttpApp {
  const app = express();

  app.get("/__env", (_req, res) => {
    const env = {
      PROXY_TARGET: target,
      PORT: port,
      CORS_ORIGINS: corsOrigins || null,
    };
    res.json({ env });
  });

  let allowedOrigins: string[] | null = null;
  if (corsOrigins) {
    allowedOrigins = corsOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }

  const corsOptions: cors.CorsOptions = {
    origin: allowedOrigins
      ? (origin, callback) => {
          if (!origin) return callback(null, true);
          if (allowedOrigins.includes(origin)) return callback(null, true);
          return callback(new Error("Not allowed by CORS"));
        }
      : true,
    credentials: true,
  };

  app.use(cors(corsOptions));

  const responseLog = createResponseLogStore();
  app.use(responseLog.middleware);

  app.use(async (req, res, next) => {
    for (const rule of overrides) {
      try {
        if (rule.test(req)) {
          const match = rule.name || "override";
          responseLog.markOverride(res, match);
          logRequestMatch(
            responseLog.resolveLogId(res),
            match,
            metaMap.get(rule),
          );
          await rule.handler(req, res, next);
          return;
        }
      } catch (err) {
        logError(responseLog.resolveLogId(res), err, rule.name);
        res.status(500).json({ error: "override_failed", detail: String(err) });
        return;
      }
    }
    next();
  });

  app.use(
    "/",
    createProxyFallback({
      target,
      nextRequestId: responseLog.nextRequestId,
      markProxyResponse: responseLog.markProxy,
      resolveLogId: responseLog.resolveLogId,
    }),
  );

  return { app, nextRequestId: responseLog.nextRequestId };
}

export function createRoutedHttpApp({
  server,
  routes,
  legacyEnv,
}: CreateRoutedHttpAppOptions): CreatedHttpApp {
  const app = express();

  if (server.control !== false) {
    app.get(server.control.path, (_req, res) => {
      if (legacyEnv) {
        res.json({
          env: {
            PROXY_TARGET: legacyEnv.target,
            PORT: legacyEnv.port,
            CORS_ORIGINS: legacyEnv.corsOrigins || null,
          },
        });
        return;
      }

      res.json({
        server: {
          name: server.name,
          host: server.host,
          port: server.preferredPort,
        },
        routes: routes.map(({ route }) => ({
          name: route.name,
          path: route.path,
          priority: route.priority,
          target: route.target,
          rules: route.rulesDirs.length,
        })),
      });
    });
  }

  if (server.cors !== false) {
    app.use(cors(createCorsOptions(server.cors.origins)));
  }

  const responseLog = createResponseLogStore();
  app.use(responseLog.middleware);

  const proxies = new Map<HttpRouteRuntime, RequestHandler>();
  for (const routeRuntime of routes) {
    if (routeRuntime.route.http === false || !routeRuntime.route.target)
      continue;

    proxies.set(
      routeRuntime,
      createProxyFallback({
        target: routeRuntime.route.target,
        nextRequestId: responseLog.nextRequestId,
        markProxyResponse: responseLog.markProxy,
        resolveLogId: responseLog.resolveLogId,
        rewritePath: (pathname) =>
          rewriteRoutePath(routeRuntime.route, pathname),
      }),
    );
  }

  app.use(async (req, res, next) => {
    const routeRuntime = findRoute(routes, req.path);
    if (!routeRuntime || routeRuntime.route.http === false) {
      next();
      return;
    }

    for (const rule of routeRuntime.overrides) {
      try {
        if (rule.test(req)) {
          const match = rule.name || "override";
          responseLog.markOverride(res, match);
          logRequestMatch(
            responseLog.resolveLogId(res),
            match,
            routeRuntime.metaMap.get(rule),
          );
          await rule.handler(req, res, next);
          return;
        }
      } catch (err) {
        logError(responseLog.resolveLogId(res), err, rule.name);
        res.status(500).json({ error: "override_failed", detail: String(err) });
        return;
      }
    }

    const proxy = proxies.get(routeRuntime);
    if (proxy) {
      proxy(req, res, next);
      return;
    }

    next();
  });

  return { app, nextRequestId: responseLog.nextRequestId };
}

function createCorsOptions(origins: string[] | true): cors.CorsOptions {
  return {
    origin:
      origins === true
        ? true
        : (origin, callback) => {
            if (!origin) return callback(null, true);
            if (origins.includes(origin)) return callback(null, true);
            return callback(new Error("Not allowed by CORS"));
          },
    credentials: true,
  };
}

function createResponseLogStore(): ResponseLogStore {
  let reqSeq = 0;
  const states = new WeakMap<Response, ResponseLogState>();
  const nextRequestId = (): number => ++reqSeq;
  const resolveLogId = (res: Response): number =>
    states.get(res)?.id ?? nextRequestId();

  return {
    nextRequestId,
    resolveLogId,
    middleware: (req, res, next) => {
      const state: ResponseLogState = {
        id: nextRequestId(),
        start: Date.now(),
      };
      states.set(res, state);
      logRequestStart(state.id, req.method, req.originalUrl);
      res.on("finish", () => {
        logRequestEnd(
          state.id,
          res.statusCode,
          Date.now() - state.start,
          state.via,
          state.matched,
        );
      });
      res.on("error", (err: Error) => {
        logError(state.id, err, state.matched);
      });
      next();
    },
    markOverride: (res, match) => {
      const state = states.get(res);
      if (!state) return;
      state.via = "override";
      state.matched = match;
    },
    markProxy: (res) => {
      const state = states.get(res);
      if (!state) return;
      state.via = "proxy";
    },
  };
}
