# WebSocket Rules

override-proxy supports raw WebSocket traffic. It does not decode Socket.IO protocol semantics.

## Mode Selection

| Need                                              | Mode                                     |
| ------------------------------------------------- | ---------------------------------------- |
| Forward traffic unchanged                         | `direct`                                 |
| Inspect, mutate, skip, or emit messages           | `bridge`                                 |
| Use real upstream data plus injected local events | `bridge` with connection rules           |
| Accept local-only client sockets without upstream | `mock`                                   |
| Send welcome messages or heartbeats               | `bridge` or `mock` with connection rules |

Start with `direct` when no message-level behavior is needed. Use `bridge` only when rules need `raw`, `text`, `json`, `jsonObject`, direction, or emit helpers.

## Target URL Behavior

WebSocket targets should usually be the upstream origin or base path. override-proxy appends the client request path after applying route rewrites. Do not repeat the route path inside `ws.target` unless the upstream intentionally expects both the target base path and the incoming request path.

For example, a client request to `/ws/chat` with `target: "wss://chat.example.com"` connects upstream to `wss://chat.example.com/ws/chat`. Setting `target: "wss://chat.example.com/ws/chat"` would try `wss://chat.example.com/ws/chat/ws/chat`.

Bridge mode forwards the client's query string to the upstream URL. This supports auth or session values passed as query parameters, such as `/ws/chat?session=demo`.

## Direct Proxy

```ts
import { defineConfig } from "@crescendolab/override-proxy";

export default defineConfig({
  servers: [
    {
      port: 4000,
      routes: [
        {
          name: "chat",
          path: "/ws/chat",
          http: false,
          ws: {
            mode: "direct",
            target: "wss://chat.example.com",
          },
        },
      ],
    },
  ],
});
```

## Bridge Message Rules

Use `wsRule()` for message-level behavior.

```ts
import { wsRule } from "@crescendolab/override-proxy";

export const PatchClientMessage = wsRule({
  name: "patch-client-message",
  test: (ctx) =>
    ctx.direction === "client" && ctx.jsonObject?.type === "message",
  handler: (ctx) =>
    ctx.forward({
      ...ctx.jsonObject,
      patchedByProxy: true,
    }),
});

export const PatchUpstreamMessage = wsRule({
  name: "patch-upstream-message",
  test: (ctx) =>
    ctx.direction === "upstream" && ctx.jsonObject?.type === "message",
  handler: (ctx) => {
    ctx.emitToClient({ type: "proxy:seen" });
    return ctx.forward({
      ...ctx.jsonObject,
      receivedByProxy: true,
    });
  },
});
```

Attach the rules:

```ts
import { defineConfig } from "@crescendolab/override-proxy";
import { PatchClientMessage, PatchUpstreamMessage } from "./rules/ws/chat.js";

export default defineConfig({
  servers: [
    {
      port: 4000,
      routes: [
        {
          name: "chat",
          path: "/ws/chat",
          http: false,
          ws: {
            mode: "bridge",
            target: "wss://chat.example.com",
            rules: [PatchClientMessage, PatchUpstreamMessage],
          },
        },
      ],
    },
  ],
});
```

If multiple enabled rules match a message, the first rule handles it. If no rule matches, the default action is `forward()`.

## Mock-Only WebSocket

Use mock mode when there is no upstream WebSocket.

```ts
import { wsRule } from "@crescendolab/override-proxy";

export const MockChat = wsRule({
  name: "mock-chat",
  test: (ctx) => ctx.direction === "client",
  handler: (ctx) => {
    ctx.emitToClient({
      type: "mock:reply",
      text: ctx.text,
      at: Date.now(),
    });
    return ctx.skip();
  },
});
```

```ts
{
  name: "mock-chat",
  path: "/ws/mock-chat",
  http: false,
  ws: {
    mode: "mock",
    rules: [MockChat],
  },
}
```

In mock mode, unmatched client messages are skipped because there is no upstream socket.

## Connection Rules

Use `wsConnectionRule()` for behavior that should run before any message arrives, such as welcome events, pings, or local server-push mocks.

```ts
import { wsConnectionRule } from "@crescendolab/override-proxy";

export const Heartbeat = wsConnectionRule({
  name: "heartbeat",
  onConnect: (ctx) => {
    ctx.client.send({ type: "proxy:ready" });
    ctx.every(30_000, () => {
      ctx.client.send({ type: "proxy:ping", at: Date.now() });
    });
  },
});
```

Attach connection rules under `ws.connectionRules`:

```ts
ws: {
  mode: "mock",
  connectionRules: [Heartbeat],
  rules: [MockChat],
}
```

Prefer `ctx.every()` and returned disposers over manual timers so cleanup happens when the connection closes.

## Real Upstream Plus Injected Events

Use bridge mode with `connectionRules` when the upstream should stay connected
but clients also need local server-push events.

```ts
import { wsConnectionRule } from "@crescendolab/override-proxy";

export const InjectReadyEvent = wsConnectionRule({
  name: "inject-ready-event",
  onConnect: (ctx) => {
    ctx.client.send({ type: "proxy:ready" });
  },
});
```

```ts
ws: {
  mode: "bridge",
  target: "wss://chat.example.com",
  connectionRules: [InjectReadyEvent],
  rules: [PatchClientMessage],
}
```

## Message Context

Message rules receive:

- `serverName`, `routeName`, `connectionId`, `path`, `headers`.
- `direction`: `"client"` or `"upstream"`.
- `raw`: original `Buffer`.
- `text`: string payload when available.
- `json`: parsed JSON when text is valid JSON, otherwise `null`.
- `jsonObject`: parsed JSON only when it is a non-array object, otherwise `null`.
- `forward(payload?)`: send original or replacement payload to the other side.
- `skip()`: do not forward this message.
- `emitToClient(payload)` and `emitToUpstream(payload)`: send extra messages.
- `close(code?, reason?)`: close the connection.
- `fail(error)`: fail with rule-error behavior.

Supported payloads are strings, `Buffer`s, and objects. Objects are serialized as JSON by the runtime.

## Connection Context

Connection rules receive:

- `client`: typed peer with `send`, `close`, and `readyState`.
- `upstream`: typed peer or `null`.
- `raw.client` and `raw.upstream`: underlying `ws` sockets for advanced cases.
- `every(intervalMs, callback)`: register a managed interval.
- `dispose(disposer)`: register cleanup.
- `close(code?, reason?)`: close the connection.

`ctx.upstream` is present only for bridge routes with a target. Sends to a connecting upstream are queued and flushed once upstream opens.

## Troubleshooting

| Symptom                                  | Check                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| WebSocket route does not accept upgrades | Confirm the matched route has `ws` enabled and `http: false` only if HTTP should be disabled.  |
| Message rule does not fire               | Confirm mode is `bridge` or `mock`; `direct` is transparent.                                   |
| JSON rule never matches                  | Check whether the payload is valid text JSON and a non-array object before using `jsonObject`. |
| Upstream is missing                      | Set route `target` or `ws.target`; mock mode intentionally has no upstream.                    |
| Upstream returns 404                     | Check whether `ws.target` repeats the route path; the client request path is appended.         |
| Heartbeat leaks timers                   | Use `ctx.every()` or register disposers with `ctx.dispose()`.                                  |
| Socket.IO app behaves oddly              | Raw WebSocket rules do not parse Socket.IO frames; use a protocol-aware adapter if needed.     |
