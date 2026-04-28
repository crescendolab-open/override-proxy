import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import {
  defineConfig,
  discoverConfigFile,
  normalizeConfig,
  normalizeLegacyConfig,
  parseConfigPath,
  validateNormalizedConfig,
} from "../config.js";

const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-config-"));

try {
  await writeFile(join(tempDir, "override-proxy.config.mjs"), "");
  await writeFile(join(tempDir, "override-proxy.config.ts"), "");

  assert.equal(
    await discoverConfigFile(tempDir),
    join(tempDir, "override-proxy.config.ts"),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

assert.equal(
  parseConfigPath(["node", "main.ts", "--config", "local.config.ts"], "/repo"),
  "/repo/local.config.ts",
);
assert.equal(
  parseConfigPath(["node", "main.ts", "--config=local.config.ts"], "/repo"),
  "/repo/local.config.ts",
);

const legacy = normalizeLegacyConfig(
  {
    TARGET: "http://upstream.example",
    PORT: 4321,
    CORS_ORIGINS: "http://localhost:3000, https://app.example",
    rulesDir: "/repo/rules",
    externalRulesDir: "/external/rules",
  },
  { cwd: "/repo" },
);
const legacyServer = legacy.servers[0]!;
const legacyRoute = legacyServer.routes[0]!;

assert.equal(legacyServer.name, "main");
assert.equal(legacyServer.preferredPort, 4321);
assert.deepEqual(legacyServer.cors, {
  origins: ["http://localhost:3000", "https://app.example"],
});
assert.deepEqual(legacyRoute.rulesDirs, ["/external/rules", "/repo/rules"]);
assert.equal(legacyRoute.target, "http://upstream.example");

const config = defineConfig({
  servers: [
    {
      routes: [
        {
          path: "/api",
          target: "https://api.example.com",
          rulesDir: "./rules",
          http: {
            rulesDirs: ["./http-rules"],
          },
          ws: {
            enabled: true,
            rulesDir: "./ws-rules",
          },
        },
      ],
    },
  ],
});
const normalized = normalizeConfig(config, {
  cwd: "/workspace",
  configFile: "/workspace/config/override-proxy.config.ts",
});
const server = normalized.servers[0]!;
const route = server.routes[0]!;

assert.equal(server.name, "main");
assert.equal(route.name, "api");
assert.deepEqual(route.rulesDirs, ["/workspace/config/rules"]);
if (route.http === false) throw new Error("Expected HTTP transport");
assert.deepEqual(route.http.rulesDirs, [
  "/workspace/config/rules",
  "/workspace/config/http-rules",
]);
if (route.ws === false) throw new Error("Expected WebSocket transport");
assert.deepEqual(route.ws.rulesDirs, [
  "/workspace/config/rules",
  "/workspace/config/ws-rules",
]);

const invalid = normalizeConfig(
  defineConfig({
    servers: [
      {
        name: "main",
        control: { path: "/" },
        routes: [
          { name: "api", path: "/api", priority: 1 },
          { name: "api", path: "/api", priority: 1 },
        ],
      },
      {
        name: "main",
        routes: [{ path: "/" }],
      },
    ],
  }),
);
invalid.servers[1]!.routes[0]!.path = "api" as "/api";

const issues = validateNormalizedConfig(invalid);
assert.ok(
  issues.some((issue) => issue.message.includes("Duplicate server name")),
);
assert.ok(
  issues.some((issue) => issue.message.includes("Duplicate route name")),
);
assert.ok(
  issues.some((issue) => issue.message.includes("Duplicate route path")),
);
assert.ok(issues.some((issue) => issue.message === "Control path cannot be /"));
assert.ok(issues.some((issue) => issue.message === "Path must start with /"));
