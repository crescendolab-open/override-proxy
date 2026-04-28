import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import getPort, { portNumbers } from "get-port";
import { join } from "pathe";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { NormalizedRoute } from "../config.js";
import { startConfiguredServers } from "../server-runtime.js";

interface UpstreamMessage {
  path: string;
  text: string | null;
  binary: boolean;
  raw: Buffer;
}

const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-ws-bridge-"));
const bridgeRulesDir = join(tempDir, "bridge");
const skipRulesDir = join(tempDir, "skip");
const mockRulesDir = join(tempDir, "mock");
const upstream = await startBridgeUpstream();

try {
  await writeRules();

  const preferredPort = await getPort({ port: portNumbers(49301, 49400) });
  const unavailableUpstreamPort = await getPort({
    port: portNumbers(49401, 49500),
  });
  const runtime = await startConfiguredServers({
    cwd: process.cwd(),
    configFile: null,
    servers: [
      {
        name: "ws-bridge-main",
        host: "127.0.0.1",
        preferredPort,
        cors: { origins: true },
        control: false,
        routes: [
          route("bridge", "/ws/bridge", "bridge", upstream.url, [
            bridgeRulesDir,
          ]),
          route("skip", "/ws/skip", "bridge", upstream.url, [skipRulesDir]),
          route("mock", "/ws/mock", "mock", null, [mockRulesDir]),
          route("binary", "/ws/binary", "bridge", upstream.url, []),
          route(
            "upstream-fail",
            "/ws/upstream-fail",
            "bridge",
            `ws://127.0.0.1:${unavailableUpstreamPort}`,
            [],
          ),
        ],
      },
    ],
  });

  try {
    const server = runtime.servers[0]!;
    const baseUrl = `ws://127.0.0.1:${server.actualPort}`;

    await assertBridgeMutatesBothDirections(baseUrl);
    await assertSkipAndEmit(baseUrl);
    await assertMockOnlyAndInvalidJson(baseUrl);
    await assertBinaryPassthrough(baseUrl);
    await assertUpstreamFailureClosesClient(baseUrl);
  } finally {
    await Promise.all(
      runtime.servers.map((server) => closeServer(server.listener)),
    );
  }
} finally {
  await closeUpstream(upstream.server);
  await rm(tempDir, { recursive: true, force: true });
}

async function writeRules(): Promise<void> {
  await mkdir(bridgeRulesDir, { recursive: true });
  await mkdir(skipRulesDir, { recursive: true });
  await mkdir(mockRulesDir, { recursive: true });

  await writeFile(
    join(bridgeRulesDir, "bridge.js"),
    `
export const PatchClientMessage = {
  test: (ctx) => ctx.direction === "client" && ctx.jsonObject?.type === "client",
  handler: (ctx) => ctx.forward({ ...ctx.jsonObject, patchedByProxy: true }),
};

export const PatchUpstreamMessage = {
  test: (ctx) => ctx.direction === "upstream" && ctx.text === "upstream:patched",
  handler: () => ({ type: "forward", payload: "client:upstream:patched" }),
};
`,
  );

  await writeFile(
    join(skipRulesDir, "skip.js"),
    `
export const EmitAndSkip = {
  test: (ctx) => ctx.direction === "client" && ctx.text === "skip-me",
  handler: (ctx) => {
    ctx.emitToClient({ type: "proxy:skipped" });
    return ctx.skip();
  },
};
`,
  );

  await writeFile(
    join(mockRulesDir, "mock.js"),
    `
export const MockInvalidJson = {
  test: (ctx) =>
    ctx.direction === "client" &&
    ctx.text === "not-json" &&
    ctx.json === null &&
    ctx.jsonObject === null,
  handler: (ctx) => {
    ctx.emitToClient({ type: "proxy:invalid-json", raw: ctx.text });
    return ctx.skip();
  },
};
`,
  );
}

function route(
  name: string,
  path: NormalizedRoute["path"],
  mode: "bridge" | "mock",
  target: string | null,
  rulesDirs: string[],
): NormalizedRoute {
  return {
    name,
    path,
    priority: 0,
    target: null,
    rulesDirs: [],
    rewrite: null,
    http: false,
    ws: {
      enabled: true,
      mode,
      target,
      rulesDirs,
    },
  };
}

async function assertBridgeMutatesBothDirections(
  baseUrl: string,
): Promise<void> {
  const client = await openSocket(`${baseUrl}/ws/bridge`);
  try {
    client.send(JSON.stringify({ type: "client", value: 1 }));

    const reply = await nextTextMessage(client);
    assert.equal(reply, "client:upstream:patched");

    const upstreamMessage = upstream.messages.find(
      (message) => message.path === "/ws/bridge",
    );
    assert.ok(upstreamMessage);
    assert.deepEqual(parseJsonObject(upstreamMessage.text ?? ""), {
      type: "client",
      value: 1,
      patchedByProxy: true,
    });
  } finally {
    await closeSocket(client);
  }
}

async function assertSkipAndEmit(baseUrl: string): Promise<void> {
  const messageCount = upstream.messages.length;
  const client = await openSocket(`${baseUrl}/ws/skip`);
  try {
    client.send("skip-me");

    const reply = parseJsonObject(await nextTextMessage(client));
    assert.equal(reply["type"], "proxy:skipped");
    await assertNoMessage(client, 150);
    assert.equal(upstream.messages.length, messageCount);
  } finally {
    await closeSocket(client);
  }
}

async function assertMockOnlyAndInvalidJson(baseUrl: string): Promise<void> {
  const client = await openSocket(`${baseUrl}/ws/mock`);
  try {
    client.send("not-json");

    const reply = parseJsonObject(await nextTextMessage(client));
    assert.deepEqual(reply, {
      type: "proxy:invalid-json",
      raw: "not-json",
    });
  } finally {
    await closeSocket(client);
  }
}

async function assertBinaryPassthrough(baseUrl: string): Promise<void> {
  const client = await openSocket(`${baseUrl}/ws/binary`);
  try {
    const payload = Buffer.from([1, 2, 3, 4]);
    client.send(payload, { binary: true });

    const reply = await nextMessage(client);
    assert.equal(reply.binary, true);
    assert.deepEqual(rawDataToBuffer(reply.data), payload);
  } finally {
    await closeSocket(client);
  }
}

async function assertUpstreamFailureClosesClient(
  baseUrl: string,
): Promise<void> {
  const client = new WebSocket(`${baseUrl}/ws/upstream-fail`);
  const close = nextClose(client);
  await waitOpen(client);

  const result = await close;
  assert.equal(result.code, 1011);
}

async function startBridgeUpstream(): Promise<{
  url: string;
  server: WebSocketServer;
  messages: UpstreamMessage[];
}> {
  const messages: UpstreamMessage[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  server.on("connection", (socket, req) => {
    const path = new URL(req.url ?? "/", "ws://localhost").pathname;
    socket.on("message", (data, binary) => {
      const raw = rawDataToBuffer(data);
      messages.push({
        path,
        text: binary ? null : raw.toString("utf8"),
        binary,
        raw,
      });

      if (binary) {
        socket.send(raw, { binary: true });
        return;
      }

      if (path === "/ws/bridge") {
        socket.send("upstream:patched");
        return;
      }

      socket.send(`echo:${raw.toString("utf8")}`);
    });
  });

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });

  const address = server.address();
  assert.ok(isAddressInfo(address));
  return {
    url: `ws://127.0.0.1:${address.port}`,
    server,
    messages,
  };
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await waitOpen(socket);
  return socket;
}

async function waitOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

async function nextTextMessage(socket: WebSocket): Promise<string> {
  const message = await nextMessage(socket);
  return rawDataToBuffer(message.data).toString("utf8");
}

async function nextMessage(socket: WebSocket): Promise<{
  data: RawData;
  binary: boolean;
}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 1000);

    socket.once("message", (data, binary) => {
      clearTimeout(timeout);
      resolve({ data, binary });
    });
    socket.once("error", reject);
  });
}

async function assertNoMessage(
  socket: WebSocket,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onMessage = (): void => {
      clearTimeout(timeout);
      reject(new Error("Expected no WebSocket message"));
    };
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      resolve();
    }, timeoutMs);

    socket.once("message", onMessage);
  });
}

async function nextClose(socket: WebSocket): Promise<{
  code: number;
  reason: string;
}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WebSocket close"));
    }, 1000);

    socket.once("close", (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString("utf8") });
    });
    socket.once("error", reject);
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;

  await new Promise<void>((resolve) => {
    socket.once("close", resolve);
    socket.close();
  });
}

async function closeServer(listener: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function closeUpstream(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function parseJsonObject(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  assert.ok(isRecord(value));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAddressInfo(
  address: string | AddressInfo | null,
): address is AddressInfo {
  return address !== null && typeof address === "object";
}
