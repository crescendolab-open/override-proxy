import assert from "node:assert/strict";
import {
  isWebSocketConnectionRule,
  isWebSocketRule,
  wsConnectionRule,
  wsRule,
  type WsMessageContext,
} from "../utils.js";

const rule = wsRule({
  test: (ctx) => ctx.direction === "client",
  handler: () => ({ type: "skip" }),
});

const ctx: WsMessageContext = {
  serverName: "main",
  routeName: "ws",
  connectionId: "main:ws",
  direction: "client",
  path: "/ws",
  headers: {},
  raw: Buffer.from("hello"),
  text: "hello",
  json: null,
  jsonObject: null,
  forward: (payload) =>
    payload === undefined ? { type: "forward" } : { type: "forward", payload },
  skip: () => ({ type: "skip" }),
  emitToClient: () => {},
  emitToUpstream: () => {},
  close: (code, reason) => ({
    type: "close",
    ...(code === undefined ? {} : { code }),
    ...(reason === undefined ? {} : { reason }),
  }),
  fail: (error) => ({ type: "fail", error }),
};

assert.equal(rule.enabled, true);
assert.equal(await rule.test(ctx), true);
assert.deepEqual(await rule.handler(ctx), { type: "skip" });

const connectionRule = wsConnectionRule({
  name: "Connected",
  onConnect: () => undefined,
});

assert.equal(connectionRule.enabled, true);
assert.equal(connectionRule.name, "Connected");
assert.equal(isWebSocketRule(rule), true);
assert.equal(isWebSocketConnectionRule(connectionRule), true);
