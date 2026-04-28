import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { loadRuleRegistryFromDirs } from "../rule-loader.js";
import { wsRule, type WsMessageContext } from "../utils.js";

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

const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-ws-rules-"));
const rulesDir = join(tempDir, "rules");

try {
  await mkdir(rulesDir, { recursive: true });
  await writeFile(
    join(rulesDir, "ws-rule.js"),
    `
export const ClientPassthrough = {
  enabled: true,
  test: (ctx) => ctx.direction === "client",
  handler: () => ({ type: "forward" }),
};
`,
  );

  const registry = await loadRuleRegistryFromDirs({ rulesDirs: [rulesDir] });
  const loaded = registry.wsRules[0]!;
  const meta = registry.wsMetaMap.get(loaded)!;

  assert.equal(registry.overrides.length, 0);
  assert.equal(registry.wsRules.length, 1);
  assert.equal(loaded.name, "ClientPassthrough");
  assert.equal(meta.file, "rules/ws-rule.js");
  assert.equal(meta.export, "ClientPassthrough");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
