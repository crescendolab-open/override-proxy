import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import getPort, { portNumbers } from "get-port";
import { startConfiguredServers } from "../server-runtime.js";
import type { NormalizedRoute } from "../config.js";

const upstream = await startRawWebSocketEchoServer();

try {
  const preferredPort = await getPort({ port: portNumbers(49201, 49300) });
  const runtime = await startConfiguredServers({
    cwd: process.cwd(),
    configFile: null,
    servers: [
      {
        name: "ws-main",
        host: "127.0.0.1",
        preferredPort,
        cors: { origins: true },
        control: false,
        routes: [
          route("ws", "/ws", upstream.url),
          {
            ...route("root", "/", null),
            ws: false,
          },
        ],
      },
    ],
  });

  try {
    const server = runtime.servers[0]!;
    const message = await websocketRoundTrip(
      `ws://127.0.0.1:${server.actualPort}/ws/echo`,
      "hello",
    );
    assert.equal(message, "echo:hello");

    await expectWebSocketRejected(`ws://127.0.0.1:${server.actualPort}/no-ws`);
  } finally {
    await Promise.all(runtime.servers.map((server) => close(server.listener)));
  }
} finally {
  await close(upstream.listener);
}

function route(
  name: string,
  path: NormalizedRoute["path"],
  wsTarget: string | null,
): NormalizedRoute {
  return {
    name,
    path,
    priority: 0,
    target: null,
    rules: [],
    rewrite: null,
    http: false,
    ws: wsTarget
      ? {
          enabled: true,
          mode: "direct",
          target: wsTarget,
          rules: [],
          connectionRules: [],
        }
      : false,
  };
}

async function startRawWebSocketEchoServer(): Promise<{
  url: string;
  listener: Server;
}> {
  const listener = createServer();

  listener.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    assert.equal(typeof key, "string");

    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );

    socket.on("data", (chunk) => {
      const opcode = chunk[0]! & 0x0f;
      if (opcode === 0x8) {
        socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
        return;
      }

      for (const message of decodeClientTextFrames(chunk)) {
        socket.write(encodeServerTextFrame(`echo:${message}`));
      }
    });
  });

  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });

  const address = listener.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `ws://127.0.0.1:${address.port}`,
    listener,
  };
}

function decodeClientTextFrames(chunk: Buffer): string[] {
  const messages: string[] = [];
  let offset = 0;

  while (offset + 6 <= chunk.length) {
    const secondByte = chunk[offset + 1]!;
    const masked = (secondByte & 0x80) !== 0;
    let length = secondByte & 0x7f;
    offset += 2;

    if (length === 126) {
      length = chunk.readUInt16BE(offset);
      offset += 2;
    }
    if (!masked || offset + 4 + length > chunk.length) break;

    const mask = chunk.subarray(offset, offset + 4);
    offset += 4;

    const payload = Buffer.alloc(length);
    for (let index = 0; index < length; index++) {
      payload[index] = chunk[offset + index]! ^ mask[index % 4]!;
    }
    offset += length;
    messages.push(payload.toString("utf8"));
  }

  return messages;
}

function encodeServerTextFrame(message: string): Buffer {
  const payload = Buffer.from(message);
  assert.ok(payload.length < 126);

  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

async function websocketRoundTrip(
  url: string,
  message: string,
): Promise<string> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket failed")), {
      once: true,
    });
  });

  const reply = new Promise<string>((resolve, reject) => {
    ws.addEventListener("message", (event) => resolve(String(event.data)), {
      once: true,
    });
    ws.addEventListener("error", () => reject(new Error("WebSocket failed")), {
      once: true,
    });
  });

  ws.send(message);
  const response = await reply;
  const closed = new Promise<void>((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
  });
  ws.close();
  await closed;
  return response;
}

async function expectWebSocketRejected(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("Timed out waiting for WebSocket rejection"));
    }, 1000);
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    ws.addEventListener(
      "open",
      () => reject(new Error("Expected WebSocket upgrade rejection")),
      { once: true },
    );
    ws.addEventListener("error", done, { once: true });
    ws.addEventListener("close", done, { once: true });
  });
}

async function close(listener: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
