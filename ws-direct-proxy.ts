import { createProxyMiddleware } from "http-proxy-middleware";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { HttpRouteRuntime } from "./http-app.js";
import {
  logWebSocketProxy,
  logWebSocketReject,
  logWebSocketUpgrade,
} from "./logger.js";
import { findRoute } from "./route-matching.js";
import { createWebSocketBridgeAcceptor } from "./ws-bridge.js";

export interface CreateWebSocketUpgradeHandlerOptions {
  routes: readonly HttpRouteRuntime[];
}

type WsProxy = ReturnType<typeof createProxyMiddleware>;

export function createWebSocketUpgradeHandler({
  routes,
}: CreateWebSocketUpgradeHandlerOptions): (
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
) => void {
  let connectionSeq = 0;
  const proxies = new Map<HttpRouteRuntime, WsProxy>();
  const bridge = createWebSocketBridgeAcceptor();

  for (const routeRuntime of routes) {
    const ws = routeRuntime.route.ws;
    if (!ws || ws.mode !== "direct" || !ws.target) continue;

    proxies.set(
      routeRuntime,
      createProxyMiddleware({
        target: ws.target,
        ws: true,
        changeOrigin: true,
      }),
    );
  }

  return (req, socket, head) => {
    const id = ++connectionSeq;
    const pathname = parseUpgradePathname(req.url);
    const routeRuntime = findRoute(routes, pathname);

    if (!routeRuntime) {
      rejectUpgrade(id, pathname, socket, "no_matching_route");
      return;
    }

    const ws = routeRuntime.route.ws;
    if (!ws) {
      rejectUpgrade(id, pathname, socket, "websocket_not_enabled", 426);
      return;
    }

    if (ws.mode === "bridge" || ws.mode === "mock") {
      logWebSocketUpgrade(id, pathname, routeRuntime.route.name);
      bridge.handleUpgrade({ id, req, socket, head, pathname, routeRuntime });
      return;
    }

    if (!ws.target) {
      rejectUpgrade(id, pathname, socket, "websocket_target_missing", 426);
      return;
    }

    const proxy = proxies.get(routeRuntime);
    if (!proxy) {
      rejectUpgrade(id, pathname, socket, "websocket_proxy_missing");
      return;
    }

    logWebSocketUpgrade(id, pathname, routeRuntime.route.name);
    logWebSocketProxy(id, ws.target);
    proxy.upgrade(req, socket, head);
  };
}

function parseUpgradePathname(url: string | undefined): string {
  return new URL(url ?? "/", "http://localhost").pathname;
}

function rejectUpgrade(
  id: number,
  pathname: string,
  socket: Socket,
  reason: string,
  statusCode = 404,
): void {
  logWebSocketReject(id, pathname, reason);
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function statusText(statusCode: number): string {
  if (statusCode === 426) return "Upgrade Required";
  if (statusCode === 502) return "Bad Gateway";
  return "Not Found";
}
