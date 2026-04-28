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
import type {
  OverrideRule,
  WebSocketConnectionRule,
  WebSocketRule,
} from "../utils.js";

const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-config-"));

try {
  await writeFile(join(tempDir, "override-proxy.config.local.ts"), "");
  await writeFile(join(tempDir, "override-proxy.config.mjs"), "");
  await writeFile(join(tempDir, "override-proxy.config.ts"), "");

  assert.equal(
    await discoverConfigFile(tempDir),
    join(tempDir, "override-proxy.config.local.ts"),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const localConfigDir = await mkdtemp(
  join(tmpdir(), "override-proxy-local-config-"),
);

try {
  await writeFile(join(localConfigDir, "override-proxy.config.local.ts"), "");
  await writeFile(join(localConfigDir, "override-proxy.local.config.ts"), "");

  assert.equal(
    await discoverConfigFile(localConfigDir),
    join(localConfigDir, "override-proxy.local.config.ts"),
  );
} finally {
  await rm(localConfigDir, { recursive: true, force: true });
}

const defaultConfigDir = await mkdtemp(
  join(tmpdir(), "override-proxy-default-config-"),
);

try {
  await writeFile(join(defaultConfigDir, "override-proxy.config.mjs"), "");
  await writeFile(join(defaultConfigDir, "override-proxy.config.ts"), "");

  assert.equal(
    await discoverConfigFile(defaultConfigDir),
    join(defaultConfigDir, "override-proxy.config.ts"),
  );
} finally {
  await rm(defaultConfigDir, { recursive: true, force: true });
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
assert.deepEqual(legacyRoute.rules, []);
assert.equal(legacyRoute.target, "http://upstream.example");

const routeRule: OverrideRule = {
  methods: ["GET"],
  test: () => true,
  handler: (_req, res) => {
    res.end();
  },
};
const httpRule: OverrideRule = {
  methods: ["POST"],
  test: () => true,
  handler: (_req, res) => {
    res.end();
  },
};
const wsMessageRule: WebSocketRule = {
  test: () => true,
  handler: (ctx) => ctx.forward(),
};
const wsConnectRule: WebSocketConnectionRule = {
  test: () => true,
  onConnect: () => undefined,
};

const config = defineConfig({
  servers: [
    {
      routes: [
        {
          path: "/api",
          target: "https://api.example.com",
          rules: [routeRule],
          http: {
            rules: [httpRule],
          },
          ws: {
            enabled: true,
            rules: [wsMessageRule],
            connectionRules: [wsConnectRule],
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
assert.deepEqual(route.rules, [routeRule]);
if (route.http === false) throw new Error("Expected HTTP transport");
assert.deepEqual(route.http.rules, [routeRule, httpRule]);
if (route.ws === false) throw new Error("Expected WebSocket transport");
assert.deepEqual(route.ws.rules, [wsMessageRule]);
assert.deepEqual(route.ws.connectionRules, [wsConnectRule]);

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
Object.assign(invalid.servers[1]!.routes[0]!, { path: "api" });

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
