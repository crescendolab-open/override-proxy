import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import getPort, { portNumbers } from "get-port";
import { join } from "pathe";
import type { NormalizedRoute } from "../config.js";
import {
  matchesRoutePath,
  rewriteRoutePath,
  sortRoutes,
} from "../route-matching.js";
import { startConfiguredServers } from "../server-runtime.js";
import type { OverrideRule } from "../utils.js";

const sorted = sortRoutes([
  route("root", "/"),
  route("api", "/api"),
  route("api-users", "/api/users"),
  route("high-priority-root", "/", 10),
]);

assert.deepEqual(
  sorted.map((entry) => entry.route.name),
  ["high-priority-root", "api-users", "api", "root"],
);
assert.equal(matchesRoutePath("/api", "/api"), true);
assert.equal(matchesRoutePath("/api", "/api/users"), true);
assert.equal(matchesRoutePath("/api", "/apix"), false);
assert.equal(matchesRoutePath("/api/", "/api/users"), true);
assert.equal(matchesRoutePath("/api/", "/api"), false);
assert.equal(
  rewriteRoutePath(
    {
      ...route("api", "/api"),
      rewrite: { stripPrefix: true, prefix: "/v2" },
    },
    "/api/users",
  ),
  "/v2/users",
);

const upstreamA = await startUpstream("api-upstream");
const upstreamB = await startUpstream("root-upstream");
const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-routing-"));

try {
  const apiMock: OverrideRule = {
    name: "api-mock",
    enabled: true,
    methods: ["GET"],
    test: (req) => req.path === "/api/mock",
    handler: (_req, res) => {
      res.json({ via: "api-rule" });
    },
  };

  const preferredPortA = await getPort({ port: portNumbers(49000, 49100) });
  const preferredPortB = await getPort({ port: portNumbers(49101, 49200) });
  const runtime = await startConfiguredServers({
    cwd: tempDir,
    configFile: null,
    servers: [
      {
        name: "one",
        host: "127.0.0.1",
        preferredPort: preferredPortA,
        cors: { origins: true },
        control: false,
        routes: [
          {
            ...route("api", "/api", 0, upstreamA.url),
            rewrite: { stripPrefix: true },
            http: { enabled: true, rules: [apiMock] },
          },
          route("root", "/", 0, upstreamB.url),
        ],
      },
      {
        name: "two",
        host: "127.0.0.1",
        preferredPort: preferredPortB,
        cors: { origins: true },
        control: false,
        routes: [route("root", "/", 0, upstreamB.url)],
      },
    ],
  });

  try {
    const serverOne = runtime.servers[0]!;
    const serverTwo = runtime.servers[1]!;

    assert.equal(runtime.overrides.length, 1);

    assert.deepEqual(
      await getJson(`http://127.0.0.1:${serverOne.actualPort}/api/mock`),
      { via: "api-rule" },
    );
    assert.deepEqual(
      await getJson(`http://127.0.0.1:${serverOne.actualPort}/api/users`),
      { upstream: "api-upstream", url: "/users" },
    );
    assert.deepEqual(
      await getJson(`http://127.0.0.1:${serverOne.actualPort}/root`),
      { upstream: "root-upstream", url: "/root" },
    );
    assert.deepEqual(
      await getJson(`http://127.0.0.1:${serverTwo.actualPort}/api/mock`),
      { upstream: "root-upstream", url: "/api/mock" },
    );
  } finally {
    await Promise.all(runtime.servers.map((server) => close(server.listener)));
  }
} finally {
  await Promise.all([close(upstreamA.listener), close(upstreamB.listener)]);
  await rm(tempDir, { recursive: true, force: true });
}

function route(
  name: string,
  path: NormalizedRoute["path"],
  priority = 0,
  target: string | null = null,
): NormalizedRoute {
  return {
    name,
    path,
    priority,
    target,
    rules: [],
    rewrite: null,
    http: {
      enabled: true,
      rules: [],
    },
    ws: false,
  };
}

async function startUpstream(
  upstream: string,
): Promise<{ url: string; listener: Server }> {
  const listener = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ upstream, url: req.url }));
  });

  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });

  const address = listener.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `http://127.0.0.1:${address.port}`,
    listener,
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function close(listener: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
