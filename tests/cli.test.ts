import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import {
  EXIT_CODES,
  loadCliConfig,
  resolveCliInvocation,
  runCli,
} from "../cli.js";

assert.deepEqual(resolveCliInvocation([]), { command: "serve", args: [] });
assert.deepEqual(resolveCliInvocation(["--config", "x.mjs"]), {
  command: "serve",
  args: ["--config", "x.mjs"],
});
assert.deepEqual(resolveCliInvocation(["serve", "--config", "x.mjs"]), {
  command: "serve",
  args: ["--config", "x.mjs"],
});
assert.deepEqual(resolveCliInvocation(["validate"]), {
  command: "validate",
  args: [],
});

const packageJson: unknown = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

assert.equal(readPath(packageJson, ["bin", "override-proxy"]), "./dist/cli.js");
assert.equal(readPath(packageJson, ["main"]), "./dist/index.js");
assert.equal(readPath(packageJson, ["types"]), "./dist/index.d.ts");
assert.equal(
  readPath(packageJson, ["scripts", "build"]),
  "tsc -p tsconfig.build.json",
);
assert.ok(readPath(packageJson, ["exports", "."]));
assert.ok(readPath(packageJson, ["exports", "./main"]));
assert.ok(readPath(packageJson, ["exports", "./cli"]));

const tempDir = await mkdtemp(join(tmpdir(), "override-proxy-cli-"));

try {
  const defaultConfig = join(tempDir, "override-proxy.config.mjs");
  const explicitConfig = join(tempDir, "explicit.config.mjs");
  const factoryConfig = join(tempDir, "factory.config.mjs");
  const asyncFactoryConfig = join(tempDir, "async-factory.config.mjs");
  const invalidConfig = join(tempDir, "invalid.config.mjs");

  await writeFile(
    defaultConfig,
    `
export default {
  servers: [{ routes: [{ path: "/", target: "http://default.example" }] }],
};
`,
  );
  await writeFile(
    explicitConfig,
    `
export default {
  servers: [{ routes: [{ path: "/", target: "http://explicit.example" }] }],
};
`,
  );
  await writeFile(
    factoryConfig,
    `
export default ({ cwd }) => ({
  servers: [{ routes: [{ path: "/", target: "http://factory.example/" + cwd.split("/").pop() }] }],
});
`,
  );
  await writeFile(
    asyncFactoryConfig,
    `
export default async () => ({
  servers: [{ routes: [{ path: "/", target: "http://async-factory.example" }] }],
});
`,
  );
  await writeFile(
    invalidConfig,
    `
export default {
  servers: [{ name: "", routes: [{ path: "/" }] }],
};
`,
  );

  const discovered = await loadCliConfig([], { cwd: tempDir });
  assert.equal(discovered.legacy, null);
  assert.equal(
    discovered.normalizedConfig.servers[0]!.routes[0]!.target,
    "http://default.example",
  );

  const explicit = await loadCliConfig(["--config", explicitConfig], {
    cwd: tempDir,
  });
  assert.equal(
    explicit.normalizedConfig.servers[0]!.routes[0]!.target,
    "http://explicit.example",
  );

  const factory = await loadCliConfig(["--config", factoryConfig], {
    cwd: tempDir,
  });
  assert.equal(
    factory.normalizedConfig.servers[0]!.routes[0]!.target,
    `http://factory.example/${tempDir.split("/").pop()}`,
  );

  const asyncFactory = await loadCliConfig(["--config", asyncFactoryConfig], {
    cwd: tempDir,
  });
  assert.equal(
    asyncFactory.normalizedConfig.servers[0]!.routes[0]!.target,
    "http://async-factory.example",
  );

  const legacyDir = await mkdtemp(join(tmpdir(), "override-proxy-legacy-"));
  try {
    const legacy = await loadCliConfig([], { cwd: legacyDir });
    assert.ok(legacy.legacy);
    assert.deepEqual(legacy.normalizedConfig.servers[0]!.routes[0]!.rules, []);
  } finally {
    await rm(legacyDir, { recursive: true, force: true });
  }

  assert.equal(await runCli(["unknown"]), EXIT_CODES.usage);
  assert.equal(
    await runCli(["validate", "--config", join(tempDir, "missing.mjs")]),
    EXIT_CODES.loader,
  );
  assert.equal(
    await runCli(["validate", "--config", invalidConfig]),
    EXIT_CODES.validation,
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
