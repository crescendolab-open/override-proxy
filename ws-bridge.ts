import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { NormalizedRoute } from "./config.js";
import type { HttpRouteRuntime } from "./http-app.js";
import {
  logError,
  logWebSocketAction,
  logWebSocketClose,
  logWebSocketMatch,
  logWebSocketProxy,
} from "./logger.js";
import { rewriteRoutePath } from "./route-matching.js";
import type {
  WsConnectionContext,
  WsConnectionDisposer,
  WsMessageContext,
  WsMessageDirection,
  WsPayload,
  WsPeer,
  WsPeerReadyState,
  WsRuleAction,
} from "./utils.js";

export interface WebSocketBridgeAcceptor {
  handleUpgrade(args: WebSocketBridgeUpgradeArgs): void;
}

export interface WebSocketBridgeUpgradeArgs {
  id: number;
  req: IncomingMessage;
  socket: Socket;
  head: Buffer;
  pathname: string;
  routeRuntime: HttpRouteRuntime;
}

type OutboundPayload = WsPayload;

interface PendingMessage {
  data: WebSocket.Data;
  binary: boolean;
  bytes: number;
}

interface BridgeConnectionOptions extends WebSocketBridgeUpgradeArgs {
  client: WebSocket;
}

interface MessageSnapshot {
  raw: Buffer;
  text: string | null;
  json: unknown | null;
  jsonObject: Record<string, unknown> | null;
  binary: boolean;
}

interface RuleResult {
  action: WsRuleAction;
  sideEffects: WsRuleAction[];
}

export function createWebSocketBridgeAcceptor(): WebSocketBridgeAcceptor {
  const server = new WebSocketServer({ noServer: true });

  return {
    handleUpgrade(args) {
      try {
        server.handleUpgrade(args.req, args.socket, args.head, (client) => {
          bridgeConnection({ ...args, client });
        });
      } catch (error) {
        logError(args.id, error);
        args.socket.destroy();
      }
    },
  };
}

function bridgeConnection({
  id,
  req,
  pathname,
  routeRuntime,
  client,
}: BridgeConnectionOptions): void {
  const startedAt = Date.now();
  const wsConfig = routeRuntime.route.ws;
  const shouldOpenUpstream =
    wsConfig !== false &&
    wsConfig.mode === "bridge" &&
    Boolean(wsConfig.target);
  const upstreamUrl =
    wsConfig !== false && shouldOpenUpstream && wsConfig.target
      ? buildUpstreamUrl(wsConfig.target, req, routeRuntime.route)
      : null;
  let upstream: WebSocket | null = null;
  let upstreamOpen = false;
  let closed = false;
  let closeLogged = false;
  // Rule handlers may be async; queue per direction to preserve socket message order.
  let clientQueue = Promise.resolve();
  let upstreamQueue = Promise.resolve();
  const pendingUpstream: PendingMessage[] = [];
  const disposers = new Set<WsConnectionDisposer>();
  let disposersClosed = false;

  const runDisposer = (disposer: WsConnectionDisposer): void => {
    try {
      void Promise.resolve(disposer()).catch((error: unknown) => {
        logError(id, error);
      });
    } catch (error) {
      logError(id, error);
    }
  };

  const registerDisposer = (
    disposer: WsConnectionDisposer,
  ): WsConnectionDisposer => {
    let active = true;
    const wrapped = (): void => {
      if (!active) return;
      active = false;
      disposers.delete(wrapped);
      runDisposer(disposer);
    };

    if (disposersClosed) {
      wrapped();
      return wrapped;
    }

    disposers.add(wrapped);
    return wrapped;
  };

  const closeDisposers = (): void => {
    if (disposersClosed) return;
    disposersClosed = true;
    for (const disposer of [...disposers]) {
      disposer();
    }
    disposers.clear();
  };

  const closeWithLog = (code: number, reason?: string): void => {
    const closeCode = normalizeCloseCode(code);
    const closeReason = normalizeCloseReason(reason);
    if (!closed) {
      closed = true;
      closeDisposers();
      if (client.readyState === WebSocket.OPEN) {
        client.close(closeCode, closeReason);
      } else if (client.readyState === WebSocket.CONNECTING) {
        client.terminate();
      }
      if (upstream) {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.close(closeCode, closeReason);
        } else if (upstream.readyState === WebSocket.CONNECTING) {
          upstream.terminate();
        }
      }
    }
    if (!closeLogged) {
      closeLogged = true;
      logWebSocketClose(id, closeCode, Date.now() - startedAt);
    }
  };

  const sendClient = (message: PendingMessage): void => {
    if (closed || client.readyState !== WebSocket.OPEN) return;
    client.send(message.data, { binary: message.binary }, (error) => {
      if (error) {
        logError(id, error);
        closeWithLog(1011, "client_send_failed");
      }
    });
  };

  const sendUpstream = (message: PendingMessage): void => {
    if (closed || !upstream) return;
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(message.data, { binary: message.binary }, (error) => {
        if (error) {
          logError(id, error);
          closeWithLog(1011, "upstream_send_failed");
        }
      });
      return;
    }
    if (upstream.readyState === WebSocket.CONNECTING) {
      pendingUpstream.push(message);
    }
  };

  const flushUpstream = (): void => {
    while (pendingUpstream.length > 0) {
      const message = pendingUpstream.shift();
      if (!message) continue;
      sendUpstream(message);
    }
  };

  const runConnectionRules = async (): Promise<void> => {
    const context = createConnectionContext({
      id,
      req,
      pathname,
      routeRuntime,
      client,
      upstream,
      sendClient,
      sendUpstream,
      close: closeWithLog,
      registerDisposer,
    });

    for (const rule of routeRuntime.wsConnectionRules) {
      if (closed) return;
      if (rule.enabled === false) continue;
      if (!(await rule.test(context))) continue;

      logWebSocketMatch(
        id,
        "connect",
        rule.name || "websocket",
        routeRuntime.wsConnectionMetaMap.get(rule),
      );

      const setup = await rule.onConnect(context);
      if (setup) context.dispose(setup);
    }
  };

  const handleMessage = async (
    direction: WsMessageDirection,
    data: RawData,
    binary: boolean,
  ): Promise<void> => {
    if (closed) return;

    const snapshot = createMessageSnapshot(data, binary);
    const result = await runRules({
      id,
      req,
      pathname,
      routeRuntime,
      direction,
      snapshot,
      hasUpstream: Boolean(upstream),
    });

    for (const sideEffect of result.sideEffects) {
      applyAction(sideEffect, direction, snapshot, {
        id,
        sendClient,
        sendUpstream,
        close: closeWithLog,
      });
    }

    applyAction(result.action, direction, snapshot, {
      id,
      sendClient,
      sendUpstream,
      close: closeWithLog,
    });
  };

  client.on("message", (data, binary) => {
    clientQueue = clientQueue
      .then(() => handleMessage("client", data, binary))
      .catch((error: unknown) => {
        logError(id, error);
        closeWithLog(1011, "rule_error");
      });
  });

  client.on("error", (error) => {
    logError(id, error);
    closeWithLog(1011, "client_error");
  });

  client.on("close", (code) => {
    closeWithLog(code || 1000);
  });

  if (upstreamUrl) {
    logWebSocketProxy(id, upstreamUrl);
    upstream = new WebSocket(upstreamUrl, {
      headers: createUpstreamHeaders(req.headers),
    });

    upstream.on("open", () => {
      upstreamOpen = true;
      flushUpstream();
    });

    upstream.on("message", (data, binary) => {
      upstreamQueue = upstreamQueue
        .then(() => handleMessage("upstream", data, binary))
        .catch((error: unknown) => {
          logError(id, error);
          closeWithLog(1011, "rule_error");
        });
    });

    upstream.on("error", (error) => {
      logError(id, error);
      if (!upstreamOpen) {
        closeWithLog(1011, "upstream_error");
      }
    });

    upstream.on("close", (code) => {
      closeWithLog(code || 1000);
    });
  } else {
    logWebSocketProxy(id, "<mock>");
  }

  void runConnectionRules().catch((error: unknown) => {
    logError(id, error);
    closeWithLog(1011, "connection_rule_error");
  });
}

interface RunRulesOptions {
  id: number;
  req: IncomingMessage;
  pathname: string;
  routeRuntime: HttpRouteRuntime;
  direction: WsMessageDirection;
  snapshot: MessageSnapshot;
  hasUpstream: boolean;
}

async function runRules({
  id,
  req,
  pathname,
  routeRuntime,
  direction,
  snapshot,
  hasUpstream,
}: RunRulesOptions): Promise<RuleResult> {
  for (const rule of routeRuntime.wsRules) {
    if (rule.enabled === false) continue;

    const sideEffects: WsRuleAction[] = [];
    const ctx = createMessageContext({
      id,
      req,
      pathname,
      routeRuntime,
      direction,
      snapshot,
      sideEffects,
    });

    if (!(await rule.test(ctx))) continue;

    logWebSocketMatch(
      id,
      direction,
      rule.name || "websocket",
      routeRuntime.wsMetaMap.get(rule),
    );

    return {
      action: await rule.handler(ctx),
      sideEffects,
    };
  }

  return {
    action:
      direction === "client" && !hasUpstream
        ? { type: "skip" }
        : { type: "forward" },
    sideEffects: [],
  };
}

interface CreateMessageContextOptions {
  id: number;
  req: IncomingMessage;
  pathname: string;
  routeRuntime: HttpRouteRuntime;
  direction: WsMessageDirection;
  snapshot: MessageSnapshot;
  sideEffects: WsRuleAction[];
}

function createMessageContext({
  id,
  req,
  pathname,
  routeRuntime,
  direction,
  snapshot,
  sideEffects,
}: CreateMessageContextOptions): WsMessageContext {
  return {
    serverName: routeRuntime.serverName,
    routeName: routeRuntime.route.name,
    connectionId: `ws:${id}`,
    direction,
    path: pathname,
    headers: req.headers,
    raw: snapshot.raw,
    text: snapshot.text,
    json: snapshot.json,
    jsonObject: snapshot.jsonObject,
    forward: (payload) =>
      payload === undefined
        ? { type: "forward" }
        : { type: "forward", payload },
    skip: () => ({ type: "skip" }),
    emitToClient: (payload) => {
      sideEffects.push({ type: "emitToClient", payload });
    },
    emitToUpstream: (payload) => {
      sideEffects.push({ type: "emitToUpstream", payload });
    },
    close: (code, reason) => ({
      type: "close",
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    }),
    fail: (error) => ({ type: "fail", error }),
  };
}

interface CreateConnectionContextOptions {
  id: number;
  req: IncomingMessage;
  pathname: string;
  routeRuntime: HttpRouteRuntime;
  client: WebSocket;
  upstream: WebSocket | null;
  sendClient(message: PendingMessage): void;
  sendUpstream(message: PendingMessage): void;
  close(code: number, reason?: string): void;
  registerDisposer(disposer: WsConnectionDisposer): WsConnectionDisposer;
}

function createConnectionContext({
  id,
  req,
  pathname,
  routeRuntime,
  client,
  upstream,
  sendClient,
  sendUpstream,
  close,
  registerDisposer,
}: CreateConnectionContextOptions): WsConnectionContext {
  return {
    serverName: routeRuntime.serverName,
    routeName: routeRuntime.route.name,
    connectionId: `ws:${id}`,
    path: pathname,
    headers: req.headers,
    client: createPeer({
      id,
      socket: client,
      send: sendClient,
      action: "emit-client",
    }),
    upstream: upstream
      ? createPeer({
          id,
          socket: upstream,
          send: sendUpstream,
          action: "emit-upstream",
        })
      : null,
    raw: {
      client,
      upstream,
    },
    every: (intervalMs, callback) => {
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new Error("ctx.every() requires an interval greater than 0ms");
      }

      const timer = setInterval(() => {
        try {
          void Promise.resolve(callback()).catch((error: unknown) => {
            logError(id, error);
          });
        } catch (error) {
          logError(id, error);
        }
      }, intervalMs);

      return registerDisposer(() => {
        clearInterval(timer);
      });
    },
    dispose: (disposer) => {
      registerDisposer(disposer);
    },
    close: (code, reason) => {
      close(code ?? 1000, reason);
    },
  };
}

interface CreatePeerOptions {
  id: number;
  socket: WebSocket;
  send(message: PendingMessage): void;
  action: "emit-client" | "emit-upstream";
}

function createPeer({ id, socket, send, action }: CreatePeerOptions): WsPeer {
  return {
    get readyState() {
      return toPeerReadyState(socket.readyState);
    },
    send: (payload) => {
      const message = materializeOutboundPayload(payload);
      send(message);
      logWebSocketAction(id, "connect", action, message.bytes);
    },
    close: (code, reason) => {
      closeSocket(socket, code, reason);
    },
  };
}

function closeSocket(
  socket: WebSocket,
  code: number | undefined,
  reason: string | undefined,
): void {
  const closeCode = normalizeCloseCode(code ?? 1000);
  const closeReason = normalizeCloseReason(reason);
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(closeCode, closeReason);
    return;
  }
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.terminate();
  }
}

function toPeerReadyState(readyState: number): WsPeerReadyState {
  switch (readyState) {
    case WebSocket.CONNECTING:
      return "connecting";
    case WebSocket.OPEN:
      return "open";
    case WebSocket.CLOSING:
      return "closing";
    default:
      return "closed";
  }
}

interface ActionTargets {
  id: number;
  sendClient(message: PendingMessage): void;
  sendUpstream(message: PendingMessage): void;
  close(code: number, reason?: string): void;
}

function applyAction(
  action: WsRuleAction,
  direction: WsMessageDirection,
  snapshot: MessageSnapshot,
  targets: ActionTargets,
): void {
  switch (action.type) {
    case "forward": {
      const message = materializePayload(action.payload, snapshot);
      if (direction === "client") {
        targets.sendUpstream(message);
      } else {
        targets.sendClient(message);
      }
      logWebSocketAction(targets.id, direction, "forward", message.bytes);
      return;
    }
    case "skip":
      logWebSocketAction(targets.id, direction, "skip");
      return;
    case "emitToClient": {
      const message = materializePayload(action.payload, snapshot);
      targets.sendClient(message);
      logWebSocketAction(targets.id, direction, "emit-client", message.bytes);
      return;
    }
    case "emitToUpstream": {
      const message = materializePayload(action.payload, snapshot);
      targets.sendUpstream(message);
      logWebSocketAction(targets.id, direction, "emit-upstream", message.bytes);
      return;
    }
    case "close":
      targets.close(action.code ?? 1000, action.reason);
      return;
    case "fail":
      targets.close(1011, action.error);
      return;
  }
}

function createMessageSnapshot(
  data: RawData,
  binary: boolean,
): MessageSnapshot {
  const raw = rawDataToBuffer(data);
  const text = binary ? null : raw.toString("utf8");
  const json = parseJson(text);

  return {
    raw,
    text,
    json,
    jsonObject: isJsonObject(json) ? json : null,
    binary,
  };
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function parseJson(text: string | null): unknown | null {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function materializePayload(
  payload: OutboundPayload | undefined,
  snapshot: MessageSnapshot,
): PendingMessage {
  if (payload === undefined) {
    return {
      data: snapshot.raw,
      binary: snapshot.binary,
      bytes: snapshot.raw.length,
    };
  }
  return materializeOutboundPayload(payload);
}

function materializeOutboundPayload(payload: OutboundPayload): PendingMessage {
  if (Buffer.isBuffer(payload)) {
    return {
      data: payload,
      binary: true,
      bytes: payload.length,
    };
  }
  if (typeof payload === "string") {
    return {
      data: payload,
      binary: false,
      bytes: Buffer.byteLength(payload),
    };
  }

  const data = JSON.stringify(payload);
  return {
    data,
    binary: false,
    bytes: Buffer.byteLength(data),
  };
}

function buildUpstreamUrl(
  target: string,
  req: IncomingMessage,
  route: NormalizedRoute,
): string {
  const upstreamUrl = new URL(target);
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const rewrittenPath = rewriteRoutePath(route, requestUrl.pathname);
  upstreamUrl.protocol = normalizeWebSocketProtocol(upstreamUrl.protocol);
  upstreamUrl.pathname = joinUrlPaths(upstreamUrl.pathname, rewrittenPath);
  upstreamUrl.search = requestUrl.search || upstreamUrl.search;
  return upstreamUrl.toString();
}

function normalizeWebSocketProtocol(protocol: string): string {
  if (protocol === "http:") return "ws:";
  if (protocol === "https:") return "wss:";
  return protocol;
}

function joinUrlPaths(prefix: string, pathname: string): string {
  const normalizedPrefix =
    !prefix || prefix === "/" ? "" : prefix.replace(/\/+$/g, "");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${normalizedPrefix}${normalizedPath}` || "/";
}

function createUpstreamHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const blocked = new Set([
    "connection",
    "host",
    "sec-websocket-extensions",
    "sec-websocket-key",
    "sec-websocket-protocol",
    "sec-websocket-version",
    "upgrade",
  ]);
  const upstreamHeaders: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || blocked.has(key.toLowerCase())) continue;
    upstreamHeaders[key] = value;
  }

  return upstreamHeaders;
}

function normalizeCloseCode(code: number): number {
  if (!Number.isInteger(code)) return 1000;
  if (code < 1000 || code >= 5000) return 1000;
  if (code === 1005 || code === 1006 || code === 1015) return 1000;
  return code;
}

function normalizeCloseReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return reason.slice(0, 123);
}
