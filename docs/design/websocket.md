# WebSocket Design

WebSocket support has three modes:

- Direct proxy mode for transparent forwarding.
- Bridge mode for bidirectional message inspection, mutation, skip, emit, connection events, and mock behavior.
- Mock mode for local-only WebSocket behavior without an upstream target.

Use direct proxy mode when no message-level logic is needed. Use bridge mode when rules need to inspect or change payloads.

## Scope

First-version WebSocket support targets raw WebSocket connections.

It does not imply Socket.IO support. Socket.IO uses its own protocol on top of WebSocket and should be added later as an adapter, not mixed into the raw WebSocket API.

## Route Config

```ts
export default defineConfig({
  servers: [
    {
      name: "main",
      port: 4000,
      routes: [
        {
          name: "chat-ws",
          path: "/ws/chat",
          ws: {
            target: "wss://chat.example.com/ws/chat",
            rulesDir: "./rules/ws",
            mode: "bridge",
          },
        },
      ],
    },
  ],
});
```

Recommended defaults:

| Field         | Default                                       |
| ------------- | --------------------------------------------- |
| `ws`          | `false`                                       |
| `ws.mode`     | `direct`                                      |
| `ws.target`   | Inherited from route `target` when compatible |
| `ws.rulesDir` | Route `rulesDir`                              |

## Rule Shape

```ts
import { wsRule } from "override-proxy";

export const PatchChatMessage = wsRule({
  test: (ctx) =>
    ctx.direction === "client" && ctx.jsonObject?.type === "message",
  handler: async (ctx) => {
    if (ctx.jsonObject?.type === "debug") return ctx.skip();

    if (ctx.jsonObject?.type === "message") {
      return ctx.forward({
        ...ctx.jsonObject,
        proxied: true,
      });
    }

    return ctx.forward();
  },
});

export const PatchUpstreamMessage = wsRule({
  test: (ctx) => ctx.direction === "upstream",
  handler: async (ctx) => {
    ctx.emitToClient({ type: "proxy:seen" });
    return ctx.forward();
  },
});
```

## Message Context

Rules receive a stable context instead of raw implementation internals.

```ts
interface WsMessageContext {
  serverName: string;
  routeName: string;
  connectionId: string;
  direction: "client" | "upstream";
  path: string;
  raw: Buffer;
  text: string | null;
  json: unknown | null;
  jsonObject: Record<string, unknown> | null;
  headers: IncomingHttpHeaders;
  forward(message?: WsMessageBody): WsAction;
  skip(): WsAction;
  emitToClient(message: WsMessageBody): void;
  emitToUpstream(message: WsMessageBody): void;
  close(code?: number, reason?: string): WsAction;
  fail(error: string): WsAction;
}
```

`json` is populated only when the message is text and parses as JSON. `jsonObject` is populated only when parsed JSON is a non-array object. Invalid JSON should not close the connection by default.

## Connection Context

Use connection rules when behavior is not tied to an incoming message. Common cases include welcome messages, periodic pings, server-push mocks, or seeding an upstream socket immediately after connect.

```ts
import { wsConnectionRule } from "override-proxy";

export const Heartbeat = wsConnectionRule({
  onConnect: (ctx) => {
    ctx.client.send({ type: "proxy:ready" });

    ctx.every(30_000, () => {
      ctx.client.send({ type: "proxy:ping", at: Date.now() });
    });
  },
});
```

```ts
interface WsConnectionContext {
  serverName: string;
  routeName: string;
  connectionId: string;
  path: string;
  headers: IncomingHttpHeaders;
  client: WsPeer;
  upstream: WsPeer | null;
  raw: {
    client: WebSocket;
    upstream: WebSocket | null;
  };
  every(intervalMs: number, callback: () => void | Promise<void>): () => void;
  dispose(disposer: () => void | Promise<void>): void;
  close(code?: number, reason?: string): void;
}

interface WsPeer {
  readyState: "connecting" | "open" | "closing" | "closed";
  send(message: WsMessageBody): void;
  close(code?: number, reason?: string): void;
}
```

`ctx.upstream` is present only for bridge routes with a target. Sends to a connecting upstream are queued and flushed once upstream opens. `ctx.every()` and returned disposers are cleaned up when the connection closes. Use `ctx.raw` only for advanced cases that need the underlying `ws` socket API.

## Actions

| Action                    | Meaning                                      |
| ------------------------- | -------------------------------------------- |
| `forward()`               | Send the original message to the other side  |
| `forward(message)`        | Send a replacement message to the other side |
| `skip()`                  | Do not send this message                     |
| `emitToClient(message)`   | Send an extra message to the client          |
| `emitToUpstream(message)` | Send an extra message to the upstream socket |
| `close(code, reason)`     | Close the connection                         |
| `fail(error)`             | Close with rule-error behavior               |

If multiple rules match a message, first matching enabled rule handles it. If no rule matches, the default action is `forward()`. In mock mode without upstream, unmatched client messages are skipped.

## Custom Events

Raw WebSocket has no event protocol. "Custom events" should be represented as messages.

Recommended JSON envelope:

```json
{
  "type": "proxy:seen",
  "payload": {
    "at": 1710000000000
  }
}
```

The helper may expose `emitEvent(type, payload)` later, but it should serialize to a normal WebSocket message.

## Connection Lifecycle

1. HTTP server receives `upgrade`.
2. Server finds the best route by normalized route matching.
3. If route has no `ws`, reject upgrade.
4. If `ws.mode` is `direct`, forward upgrade transparently.
5. If `ws.mode` is `bridge`, accept client socket and optionally connect upstream.
6. If `ws.mode` is `mock`, accept client socket without opening upstream.
7. Run connection rules.
8. Apply message rules for each direction.
9. Close both sides and clean connection disposers when either side closes.

## Mock-Only Mode

Mock-only WebSocket routes omit `target`:

```ts
ws: {
  mode: 'bridge',
  rulesDir: './rules/ws',
}
```

Rules can reply to client messages without opening an upstream socket. `emitToUpstream()` should be a no-op or validation error depending on strictness config.

## Error Semantics

| Error                       | Default behavior                                                    |
| --------------------------- | ------------------------------------------------------------------- |
| No matching WebSocket route | Close upgrade with HTTP 404                                         |
| Route has `ws: false`       | Close upgrade with HTTP 426                                         |
| Upstream connect fails      | Close client with code `1011`                                       |
| Rule throws                 | Close with code `1011` unless configured to emit error and continue |
| Invalid JSON                | Keep raw message; `ctx.json` is `null`                              |
| Client sends binary         | Forward as `Buffer` unless rule changes it                          |

Close reasons should be short and non-sensitive.

## Observability

WebSocket logs should use connection identity:

```text
[ws:12] -> main chat-ws /ws/chat
[ws:12] client match PatchChatMessage
[ws:12] client forward 58b
[ws:12] upstream emit 29b
[ws:12] <- close 1000 42ms ws-forward
```

Do not log full payloads by default. Payload logging should require explicit debug mode.

## Use Cases

| Case                    | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| Direct forwarding       | Client connects through override-proxy to an upstream WebSocket unchanged |
| Client-side mutation    | Client message is edited before it reaches upstream                       |
| Upstream-side mutation  | Upstream message is edited before it reaches client                       |
| Client-side skip        | Selected client messages are not sent upstream                            |
| Upstream-side skip      | Selected upstream messages are not sent to client                         |
| Custom client message   | Rule emits an additional message to the client                            |
| Custom upstream message | Rule emits an additional message to upstream                              |
| Connection welcome      | Rule sends a client message immediately after connect                     |
| Connection heartbeat    | Rule sends periodic ping messages without waiting for incoming traffic    |
| Mock-only socket        | Route handles WebSocket messages without opening an upstream connection   |
| Binary passthrough      | Binary frames are forwarded unless a rule changes them                    |

## Validation Cases

| Case                                         | Expected result                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `ws: false` route receives upgrade           | Upgrade rejected                                                             |
| Direct proxy route connects to echo upstream | Messages pass both directions                                                |
| Bridge route mutates client message          | Upstream receives replacement payload                                        |
| Bridge route mutates upstream message        | Client receives replacement payload                                          |
| Rule returns `skip()` for client message     | Upstream receives nothing                                                    |
| Rule calls `emitToClient()`                  | Client receives extra message                                                |
| `wsConnectionRule()` sends on connect        | Client receives message before sending anything                              |
| `wsConnectionRule()` uses `ctx.every()`      | Client receives periodic messages and timer stops on close                   |
| Connection rule sends to connecting upstream | Message is queued and flushed after upstream opens                           |
| Mock-only route has no target                | Client can still receive rule-generated messages                             |
| Upstream unavailable                         | Client closes with configured code and server stays alive                    |
| Invalid JSON text message                    | Rule sees `json: null`, `jsonObject: null`, and raw text remains forwardable |
| Binary message                               | Rule can forward or replace `Buffer` payload                                 |
