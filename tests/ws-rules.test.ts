import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { loadRuleRegistryFromDirs } from "../rule-loader.js";
import { wsConnectionRule, wsRule, type WsMessageContext } from "../utils.js";

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

const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-ws-rules-"));
const rulesDir = join(tempDir, "rules");

try {
  await mkdir(rulesDir, { recursive: true });
  await writeFile(
    join(rulesDir, "ws-rule.mjs"),
    `
export const ClientPassthrough = {
  enabled: true,
  test: (ctx) => ctx.direction === "client",
  handler: () => ({ type: "forward" }),
};

export const Heartbeat = {
  enabled: true,
  test: () => true,
  onConnect: () => undefined,
};
`,
  );

  const registry = await loadRuleRegistryFromDirs({ rulesDirs: [rulesDir] });
  const loaded = registry.wsRules[0]!;
  const meta = registry.wsMetaMap.get(loaded)!;
  const loadedConnection = registry.wsConnectionRules[0]!;
  const connectionMeta = registry.wsConnectionMetaMap.get(loadedConnection)!;

  assert.equal(registry.overrides.length, 0);
  assert.equal(registry.wsRules.length, 1);
  assert.equal(registry.wsConnectionRules.length, 1);
  assert.equal(loaded.name, "ClientPassthrough");
  assert.equal(meta.file, "rules/ws-rule.mjs");
  assert.equal(meta.export, "ClientPassthrough");
  assert.equal(loadedConnection.name, "Heartbeat");
  assert.equal(connectionMeta.file, "rules/ws-rule.mjs");
  assert.equal(connectionMeta.export, "Heartbeat");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
